import { createClient } from '@supabase/supabase-js'
import { rankCandidates, badgesFor, templatePitch, buildMessages, parsePitches } from '../_lib/suggestCore.js'

// AI-коуч официанта — Vercel serverless-функция (same-origin с приложением
// официанта). Ключ DeepSeek и сервисный ключ Supabase живут в Vercel env,
// в браузер не попадают (имена БЕЗ префикса VITE_).
//
// Костинг (menu_item_costing / dish_daily_flags) под RLS без клиентских
// политик → читаем под service_role, поэтому себестоимость не покидает сервер.
//
// URL берём из уже существующей VITE_SUPABASE_WAITER_URL (её видно и функции),
// чтобы не плодить переменную. А вот КЛЮЧ обязан быть service_role и БЕЗ
// префикса VITE_ — иначе Vite вшил бы его в браузерный бандл (утечка сервисного
// ключа = полный доступ к базе у любого гостя). Поэтому SUPABASE_SERVICE_KEY.
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_WAITER_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

const FLAG_PRI = { stop: 3, expiring: 2, special: 1 }

// Дайджест меню: блюдо + маржа/приоритет + флаг дня. Три быстрых запроса и
// склейка в памяти.
async function buildDigest(restaurantId) {
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

// Вызов DeepSeek (OpenAI-совместимый) с жёстким таймаутом. При сбое → null,
// сработает шаблонный фолбэк.
async function callDeepSeek({ candidates, stage, tag, guest }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(`${DEEPSEEK_BASE.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: buildMessages({ candidates, stage, tag, guest }),
        response_format: { type: 'json_object' },
        temperature: 0.6,
        max_tokens: 700,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}`)
    const data = await res.json()
    return parsePitches(data?.choices?.[0]?.message?.content, candidates)
  } finally {
    clearTimeout(timer)
  }
}

async function suggest({ restaurantId, stage, tag, guest, exclude, limit }) {
  const digest = await buildDigest(restaurantId)
  const candidates = rankCandidates(digest, { tag, exclude, limit })
  if (candidates.length === 0) return { suggestions: [], source: 'empty' }

  let pitches = null
  if (DEEPSEEK_KEY) {
    pitches = await callDeepSeek({ candidates, stage, tag, guest }).catch(() => null)
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

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' })
    return
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
  const restaurantId = String(body.restaurantId || '').trim()
  if (!restaurantId) {
    res.status(400).json({ error: 'restaurantId обязателен' })
    return
  }
  try {
    const result = await suggest({
      restaurantId,
      stage: body.stage,
      tag: body.tag,
      guest: body.guest,
      exclude: Array.isArray(body.exclude) ? body.exclude : [],
      limit: body.limit,
    })
    res.status(200).json(result)
  } catch (err) {
    console.error('waiter/suggest failed:', err)
    res.status(502).json({ error: 'Не удалось получить подсказку' })
  }
}
