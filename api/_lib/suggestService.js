// AI-коуч официанта — общий I/O-сервис для /suggest и /warm.
// Здесь: дайджест меню из БД, вызов DeepSeek, сборка подсказок и тёплый кэш
// в Supabase (Vercel-функции без состояния, поэтому кэш — в БД).
//
// Ключи и URL — из Vercel env; SUPABASE_SERVICE_KEY без префикса VITE_, чтобы
// не утечь в браузерный бандл. Костинг под RLS читаем под service_role.

import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  rankCandidates, badgesFor, templatePitch, buildMessages, parsePitches,
  pickPools, buildRecommendMessages, parseRecommendText, templateSet,
} from './suggestCore.js'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_WAITER_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

const FLAG_PRI = { stop: 3, expiring: 2, special: 1 }
const CACHE_TTL_SEC = 300

// Дайджест меню: блюдо + маржа/приоритет + флаг дня.
export async function buildDigest(restaurantId) {
  const today = new Date().toISOString().slice(0, 10)
  const [items, costing, flags] = await Promise.all([
    supabase.from('menu_items')
      .select('id, dish_name, description, cost_rub, menu_section, product_type, is_available')
      .eq('restaurant_id', restaurantId)
      .eq('is_available', true),
    supabase.from('menu_item_costing')
      .select('dish_id, margin_abs, margin_pct, push_priority, push_reason')
      .eq('restaurant_id', restaurantId),
    supabase.from('dish_daily_flags')
      .select('dish_id, flag, note')
      .eq('restaurant_id', restaurantId)
      .eq('day', today),
  ])
  if (items.error) throw items.error

  const costMap = new Map((costing.data || []).map((c) => [c.dish_id, c]))
  const flagMap = new Map()
  for (const f of flags.data || []) {
    const cur = flagMap.get(f.dish_id)
    if (!cur || (FLAG_PRI[f.flag] || 0) > (FLAG_PRI[cur.flag] || 0)) flagMap.set(f.dish_id, f)
  }

  return (items.data || []).map((mi) => {
    const c = costMap.get(mi.id) || {}
    const f = flagMap.get(mi.id)
    return {
      id: mi.id,
      name: mi.dish_name,
      description: mi.description || '',
      price: mi.cost_rub,
      section: mi.menu_section,
      productType: mi.product_type,
      available: mi.is_available !== false,
      marginAbs: c.margin_abs,
      marginPct: c.margin_pct,
      pushPriority: c.push_priority || 0,
      pushReason: c.push_reason || null,
      dailyFlag: f?.flag || null,
      dailyNote: f?.note || null,
    }
  })
}

// Один вызов DeepSeek (JSON-режим). Возвращает сырой content; при сбое бросает.
async function deepseekChat(messages, { maxTokens = 700, timeoutMs = 6000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${DEEPSEEK_BASE.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.6,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content
  } finally {
    clearTimeout(timer)
  }
}

async function callDeepSeek({ candidates, stage, tag, guest, cart }) {
  const content = await deepseekChat(buildMessages({ candidates, stage, tag, guest, cart }))
  return parsePitches(content, candidates)
}

// Рекомендательный набор для виджета «Подсказка от RestAI» — один связный текст.
export async function recommendSet({ restaurantId, cartItemIds, guest }) {
  const digest = await buildDigest(restaurantId)
  const cartSet = new Set(cartItemIds || [])
  const cartNames = digest.filter((d) => cartSet.has(d.id)).map((d) => d.name)
  const pools = pickPools(digest, { exclude: cartItemIds || [] })

  const hasAny = pools.main.length || pools.alco.length || pools.soft.length || pools.dessert.length
  if (!hasAny) return { text: null, source: 'empty' }

  if (!DEEPSEEK_KEY) return { text: templateSet(pools), source: 'fallback' }

  const raw = await deepseekChat(
    buildRecommendMessages({ cart: cartNames, pools, guest }),
    { maxTokens: 500, timeoutMs: 9000 },
  ).catch(() => null)
  const text = parseRecommendText(raw)
  return text ? { text, source: 'llm' } : { text: templateSet(pools), source: 'fallback' }
}

// Считает подсказки с нуля. Можно передать готовый digest (чтобы /warm строил
// его один раз на все теги).
export async function computeSuggestions({ restaurantId, stage, tag, guest, exclude, limit, cartItemIds, digest }) {
  const dg = digest || await buildDigest(restaurantId)
  const cartSet = new Set(cartItemIds || [])
  const cartNames = dg.filter((d) => cartSet.has(d.id)).map((d) => d.name)
  const fullExclude = [...(exclude || []), ...(cartItemIds || [])]
  const candidates = rankCandidates(dg, { tag, exclude: fullExclude, limit })
  if (candidates.length === 0) return { suggestions: [], source: 'empty' }

  let pitches = null
  if (DEEPSEEK_KEY) {
    pitches = await callDeepSeek({ candidates, stage, tag, guest, cart: cartNames }).catch(() => null)
  }

  const suggestions = candidates.map((item) => {
    const p = pitches?.find((x) => x.dishId === item.id)
    return {
      dishId: item.id,
      name: item.name,
      price: item.price,
      pitch: p?.pitch || templatePitch(item),
      addon: p?.addon || null,
      reason: item.pushReason || null,
      badges: badgesFor(item),
    }
  })

  return { suggestions, source: pitches ? 'llm' : 'fallback' }
}

// Стабильный ключ кэша: sha1 нормализованных входных данных БЕЗ exclude
// (кэшируем только первый тап по тегу; «другой вариант» считаем живьём).
export function cacheKey({ restaurantId, stage, tag, guest, cartItemIds }) {
  const g = guest || {}
  const norm = {
    // Версия промта. Бампать при смене формулировок — иначе в waiter_ai_cache
    // залипает текст, сгенерированный старым промтом. v2 — короткая директивная
    // подсказка; v3 — реплика строго в одних кавычках «…» (фронт её жирнит).
    v: 3,
    r: restaurantId,
    s: stage || '',
    t: tag || '',
    g: { gender: g.gender || '', age: g.age || '', occasion: g.occasion || '' },
    c: [...(cartItemIds || [])].sort(),
  }
  return crypto.createHash('sha1').update(JSON.stringify(norm)).digest('hex')
}

export async function readCache(key) {
  const { data } = await supabase
    .from('waiter_ai_cache')
    .select('suggestions, source')
    .eq('cache_key', key)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  return data ? { suggestions: data.suggestions, source: data.source } : null
}

export async function writeCache(key, value) {
  const expires = new Date(Date.now() + CACHE_TTL_SEC * 1000).toISOString()
  await supabase.from('waiter_ai_cache').upsert({
    cache_key: key,
    suggestions: value.suggestions,
    source: value.source,
    created_at: new Date().toISOString(),
    expires_at: expires,
  })
}
