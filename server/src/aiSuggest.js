// AI-коуч официанта — I/O и оркестрация.
// buildDigest — компактный «дайджест» меню с маржой и флагами дня (читаем под
// service_role, поэтому себестоимость не покидает сервер). callDeepSeek — сам
// вызов модели. suggest — собирает кандидатов (детерминированно) и просит
// DeepSeek написать скрипт; без ключа/при сбое отдаёт шаблонные подсказки.

import { config } from './config.js'
import { supabaseAdmin } from './supabase.js'
import { rankCandidates, badgesFor, templatePitch, buildMessages, parsePitches } from './aiSuggestCore.js'

// Приоритет флага, если у блюда их несколько на день (стоп важнее всего).
const FLAG_PRI = { stop: 3, expiring: 2, special: 1 }

// Дайджест меню ресторана: блюдо + маржа/приоритет + флаг дня. Три быстрых
// запроса и склейка в памяти — прозрачнее, чем вложенные select, и на ~200
// блюдах дёшево.
async function buildDigest(restaurantId) {
  const today = new Date().toISOString().slice(0, 10)
  const [items, costing, flags] = await Promise.all([
    supabaseAdmin.from('menu_items')
      .select('id, dish_name, description, cost_rub, menu_section, product_type, is_available')
      .eq('restaurant_id', restaurantId)
      .eq('is_available', true),
    supabaseAdmin.from('menu_item_costing')
      .select('dish_id, margin_abs, margin_pct, push_priority, push_reason')
      .eq('restaurant_id', restaurantId),
    supabaseAdmin.from('dish_daily_flags')
      .select('dish_id, flag, note')
      .eq('restaurant_id', restaurantId)
      .eq('day', today),
  ])
  if (items.error) throw items.error

  const costMap = new Map((costing.data || []).map(c => [c.dish_id, c]))
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

// Вызов DeepSeek (OpenAI-совместимый). Жёсткий таймаут — коуч не должен ждать
// модель дольше пары секунд; при сбое возвращаем null → сработает фолбэк.
async function callDeepSeek({ candidates, stage, tag, guest }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(`${config.deepseekBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel,
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

// Главная функция: подсказки апсейла для стадии/тега/гостя.
export async function suggest({ restaurantId, stage, tag, guest, exclude, limit }) {
  const digest = await buildDigest(restaurantId)
  const candidates = rankCandidates(digest, { tag, exclude, limit })
  if (candidates.length === 0) return { suggestions: [], source: 'empty' }

  let pitches = null
  if (config.deepseekApiKey) {
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
