// Пары блюд для гостевого меню — I/O: меню из БД, DeepSeek, таблица
// menu_pairings. Логика выбора и промпты — в pairingCore.js.
//
// Таблицы (миграция RestAI/supabase/migrations/20261013010000_menu_pairings.sql):
//   menu_pairings       — пары: dish_id → pair_dish_id, фразы lead/reason,
//                         source ai|manual, status active|disabled;
//   menu_pairing_state  — по ресторану: хэш меню, когда и чем закончился расчёт.
// Пишем под service_role (ключ только на сервере).

import crypto from 'node:crypto'
import { supabase as realSupabase, deepseekChat as realDeepseek, DEEPSEEK_KEY } from './suggestService.js'
import {
  canBeAnchor, canBePair, compactMenu, menuFingerprint, buildGenerateMessages, parseGenerated,
  chunk, capPairUsage, dislikeMatcher, guestTasteLine, buildPersonalMessages, parsePersonal,
} from './pairingCore.js'

const ANCHORS_PER_CALL = 12
const PARALLEL_CALLS = 3
const RUNNING_STALE_MS = 15 * 60 * 1000
const PERSONAL_TTL_SEC = 3600
const PERSONAL_MAX_ANCHORS = 80
// Одно блюдо — пара не больше чем к стольким блюдам меню.
const MAX_USES_PER_PAIR = 6

// Зависимости через объект — тест подменяет базу и нейросеть
// (pairingService.test.js), код ниже обращается к ним только так.
export const deps = { supabase: realSupabase, deepseekChat: realDeepseek, hasKey: () => !!DEEPSEEK_KEY }

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

async function loadMenu(restaurantId) {
  const { data, error } = await deps.supabase
    .from('menu_items')
    .select('id, dish_name, description, cost_rub, menu_section, product_type, is_available, ingredients')
    .eq('restaurant_id', restaurantId)
  if (error) throw error
  return (data || []).map((mi) => ({
    id: mi.id,
    name: mi.dish_name,
    description: mi.description || '',
    price: Number(mi.cost_rub) || 0,
    section: mi.menu_section || '',
    productType: mi.product_type,
    available: mi.is_available !== false,
    ingredients: Array.isArray(mi.ingredients) ? mi.ingredients : [],
  }))
}

async function restaurantName(restaurantId) {
  const { data } = await deps.supabase.from('restaurants').select('name').eq('restaurantId', restaurantId).maybeSingle()
  return data?.name || ''
}

async function setState(restaurantId, patch) {
  await deps.supabase.from('menu_pairing_state').upsert({ restaurant_id: restaurantId, ...patch, updated_at: new Date().toISOString() })
}

export async function getState(restaurantId) {
  const { data } = await deps.supabase.from('menu_pairing_state').select('*').eq('restaurant_id', restaurantId).maybeSingle()
  return data || null
}

// Пересчёт пар ресторана. Без force пропускает, если меню не менялось с
// прошлого удачного расчёта. Ручные пары и пары, которые менеджер выключил,
// не трогает: выключенная пара не вернётся при следующем расчёте.
export async function generateForRestaurant(restaurantId, { force = false } = {}) {
  if (!deps.hasKey()) throw new Error('Нет DEEPSEEK_API_KEY')

  const items = (await loadMenu(restaurantId)).filter((i) => i.available)
  const hash = sha1(menuFingerprint(items))
  const state = await getState(restaurantId)

  if (state?.status === 'running' && Date.now() - new Date(state.started_at).getTime() < RUNNING_STALE_MS) {
    return { status: 'running' }
  }
  if (!force && state?.status === 'done' && state.menu_hash === hash) {
    return { status: 'unchanged', pairCount: state.pair_count }
  }

  await setState(restaurantId, { status: 'running', started_at: new Date().toISOString(), error: null })

  try {
    const name = await restaurantName(restaurantId)
    const menu = compactMenu(items)
    const anchorNumbers = items.map((it, i) => (canBeAnchor(it) ? i + 1 : null)).filter(Boolean)
    const batches = chunk(anchorNumbers, ANCHORS_PER_CALL)
    // Нечего считать (пустое или тестовое меню) — это не ошибка.
    if (!anchorNumbers.length) {
      await setState(restaurantId, { status: 'done', menu_hash: hash, generated_at: new Date().toISOString(), pair_count: 0, error: null })
      return { status: 'done', pairCount: 0, anchors: 0 }
    }
    const stats = {}

    const generated = []
    const doneAnchorIds = new Set()
    let failed = 0
    for (const group of chunk(batches, PARALLEL_CALLS)) {
      const results = await Promise.all(group.map(async (nums) => {
        try {
          const raw = await deps.deepseekChat(
            // В список — только то, что может быть парой, и блюда этой пачки:
            // алкоголь и «Лавку» модель не видит и не предлагает.
            buildGenerateMessages({
              menu: menu.filter((m) => canBePair(items[m.n - 1]) || nums.includes(m.n)),
              anchorNumbers: nums,
              restaurantName: name,
            }),
            { maxTokens: 4000, timeoutMs: 90000, temperature: 0.4 },
          )
          return { nums, pairs: parseGenerated(raw, items, nums, stats) }
        } catch (err) {
          console.error('pairings: batch failed', err?.message || err)
          return null
        }
      }))
      for (const r of results) {
        if (!r) { failed++; continue }
        r.nums.forEach((n) => doneAnchorIds.add(items[n - 1].id))
        generated.push(...r.pairs)
      }
    }
    if (doneAnchorIds.size === 0) throw new Error('Нейросеть не ответила ни на одну пачку')

    // Пары, которые трогать нельзя: ручные и выключенные менеджером.
    const { data: existing, error: exErr } = await deps.supabase
      .from('menu_pairings')
      .select('id, dish_id, pair_dish_id, source, status')
      .eq('restaurant_id', restaurantId)
    if (exErr) throw exErr
    const keep = new Set((existing || [])
      .filter((r) => r.source === 'manual' || r.status === 'disabled')
      .map((r) => `${r.dish_id}|${r.pair_dish_id}`))

    // Старые автоматические пары удаляем только у блюд, по которым расчёт
    // прошёл: при сбое пачки у её блюд остаются прежние пары.
    const staleIds = (existing || [])
      .filter((r) => r.source === 'ai' && r.status === 'active' && doneAnchorIds.has(r.dish_id))
      .map((r) => r.id)
    for (const ids of chunk(staleIds, 200)) {
      const { error } = await deps.supabase.from('menu_pairings').delete().in('id', ids)
      if (error) throw error
    }

    const now = new Date().toISOString()
    const rows = capPairUsage(generated, MAX_USES_PER_PAIR)
      .filter((g) => !keep.has(`${g.anchorId}|${g.pairId}`))
      .map((g) => ({
        restaurant_id: restaurantId,
        dish_id: g.anchorId,
        pair_dish_id: g.pairId,
        rank: g.rank,
        lead: g.lead,
        reason: g.why,
        source: 'ai',
        status: 'active',
        updated_at: now,
      }))
    for (const part of chunk(rows, 200)) {
      const { error } = await deps.supabase.from('menu_pairings').upsert(part, { onConflict: 'dish_id,pair_dish_id' })
      if (error) throw error
    }

    // Частичный сбой — не «done»: следующий запуск пересчитает даже при том же меню.
    await setState(restaurantId, {
      status: failed ? 'partial' : 'done',
      menu_hash: hash,
      generated_at: now,
      pair_count: rows.length,
      error: failed ? `Не ответили пачки: ${failed} из ${batches.length}` : null,
    })
    const withPairs = new Set(rows.map((r) => r.dish_id)).size
    return { status: failed ? 'partial' : 'done', pairCount: rows.length, anchors: doneAnchorIds.size, dishesWithPairs: withPairs, stats }
  } catch (err) {
    await setState(restaurantId, { status: 'error', error: String(err?.message || err).slice(0, 500) })
    throw err
  }
}

export async function generateAll({ force = false } = {}) {
  const { data, error } = await deps.supabase.from('restaurants').select('"restaurantId"')
  if (error) throw error
  const out = []
  for (const r of data || []) {
    const id = r.restaurantId
    if (!id) continue
    try {
      out.push({ restaurantId: id, ...(await generateForRestaurant(id, { force })) })
    } catch (err) {
      out.push({ restaurantId: id, status: 'error', error: String(err?.message || err) })
    }
  }
  return out
}

// Активные пары ресторана: ручные первыми, затем по rank.
async function loadActivePairs(restaurantId) {
  const { data, error } = await deps.supabase
    .from('menu_pairings')
    .select('dish_id, pair_dish_id, rank, lead, reason, source, updated_at')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')
  if (error) throw error
  return (data || []).sort((a, b) =>
    (a.source === 'manual' ? 0 : 1) - (b.source === 'manual' ? 0 : 1) || a.rank - b.rank)
}

async function loadGuest(deviceId) {
  const { data: gid } = await deps.supabase.rpc('guest_id_for_device', { p_device_id: deviceId })
  if (!gid) return null
  const { data } = await deps.supabase.from('guests').select('dislikes, preferences').eq('id', gid).maybeSingle()
  return data || null
}

// Пары под конкретного гостя. Возвращает { personal:false }, если о госте
// ничего не известно — тогда фронт показывает общие пары из /api/menu.
export async function personalPairings({ restaurantId, deviceId }) {
  const guest = deviceId ? await loadGuest(deviceId) : null
  const dislikes = String(guest?.dislikes || '').trim()
  const history = guest?.preferences && typeof guest.preferences === 'object' ? guest.preferences : null
  const hasHistory = !!(history && ((history.top_dishes || []).length || Object.keys(history.sections || {}).length))
  if (!dislikes && !hasHistory) return { personal: false }

  const pairs = await loadActivePairs(restaurantId)
  if (!pairs.length) return { personal: false }
  const version = pairs.reduce((m, p) => (p.updated_at > m ? p.updated_at : m), '')

  const key = sha1(JSON.stringify({ v: 1, k: 'pairings', r: restaurantId, d: deviceId, x: dislikes, h: history, p: version }))
  const cached = await deps.supabase.from('waiter_ai_cache').select('suggestions, source')
    .eq('cache_key', key).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (cached.data?.suggestions) return { personal: true, cached: true, source: cached.data.source, pairings: cached.data.suggestions }

  const items = await loadMenu(restaurantId)
  const byId = new Map(items.map((i) => [i.id, i]))
  const blocked = dislikeMatcher(dislikes)

  // Строгий фильтр: пары, которые гостю нельзя, выбрасываем совсем.
  const options = new Map()
  for (const p of pairs) {
    const dish = byId.get(p.pair_dish_id)
    if (!dish || !dish.available || !byId.get(p.dish_id) || blocked(dish)) continue
    const list = options.get(p.dish_id) || []
    if (list.length < 3) list.push({ dishId: p.pair_dish_id, lead: p.lead, why: p.reason })
    options.set(p.dish_id, list)
  }

  // Без ИИ: первая уцелевшая пара. Пустой список — блюдо без подсказки.
  const result = {}
  for (const p of pairs) if (!(p.dish_id in result)) result[p.dish_id] = []
  for (const [anchorId, list] of options) result[anchorId] = [{ ...list[0], personal: false }]

  let source = 'filter'
  const taste = guestTasteLine({ dislikes, history })
  const choosable = [...options.entries()].filter(([, list]) => list.length > 1).slice(0, PERSONAL_MAX_ANCHORS)
  if (deps.hasKey() && hasHistory && choosable.length) {
    let n = 0
    const anchors = choosable.map(([anchorId, list]) => ({
      n: ++n,
      anchorId,
      name: byId.get(anchorId)?.name,
      options: list.map((o, i) => ({ n: i + 1, name: byId.get(o.dishId)?.name, why: o.why, ref: o })),
    }))
    const forPrompt = anchors.map((a) => ({ n: a.n, name: a.name, options: a.options.map(({ n: on, name, why }) => ({ n: on, name, why })) }))
    const raw = await deps.deepseekChat(buildPersonalMessages({ anchors: forPrompt, taste }), { maxTokens: 2500, timeoutMs: 15000, temperature: 0.4 })
      .catch(() => null)
    const picks = parsePersonal(raw, anchors)
    if (picks.size) {
      source = 'llm'
      for (const a of anchors) {
        const pick = picks.get(a.n)
        if (!pick) continue
        const opt = a.options.find((o) => o.n === pick.p)?.ref
        if (opt) result[a.anchorId] = [{ ...opt, why: pick.why || opt.why, personal: !!pick.why }]
      }
    }
  }

  await deps.supabase.from('waiter_ai_cache').upsert({
    cache_key: key,
    suggestions: result,
    source,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + PERSONAL_TTL_SEC * 1000).toISOString(),
  })
  return { personal: true, source, pairings: result }
}

// ── Админка: список и правка пар ──

export async function listPairs(restaurantId) {
  const [{ data: rows, error }, items, state] = await Promise.all([
    deps.supabase.from('menu_pairings')
      .select('id, dish_id, pair_dish_id, rank, lead, reason, source, status, updated_at')
      .eq('restaurant_id', restaurantId),
    loadMenu(restaurantId),
    getState(restaurantId),
  ])
  if (error) throw error
  const byId = new Map(items.map((i) => [i.id, i]))
  const pairs = (rows || []).map((r) => ({
    ...r,
    dish_name: byId.get(r.dish_id)?.name || '—',
    dish_section: byId.get(r.dish_id)?.section || '',
    pair_name: byId.get(r.pair_dish_id)?.name || '—',
    pair_price: byId.get(r.pair_dish_id)?.price ?? null,
  })).sort((a, b) => a.dish_section.localeCompare(b.dish_section, 'ru') || a.dish_name.localeCompare(b.dish_name, 'ru') || a.rank - b.rank)
  const menu = items.map((i) => ({ id: i.id, name: i.name, section: i.section, price: i.price }))
  return { pairs, menu, state }
}

export async function updatePair(restaurantId, id, patch) {
  const allowed = {}
  if (patch.status === 'active' || patch.status === 'disabled') allowed.status = patch.status
  if (typeof patch.lead === 'string' && patch.lead.trim()) allowed.lead = patch.lead.trim().slice(0, 120)
  if (typeof patch.reason === 'string' && patch.reason.trim()) allowed.reason = patch.reason.trim().slice(0, 160)
  if (!Object.keys(allowed).length) throw new Error('Нечего менять')
  // Текст, поправленный менеджером, больше не перезапишет авторасчёт.
  if (allowed.lead || allowed.reason) allowed.source = 'manual'
  allowed.updated_at = new Date().toISOString()
  const { data, error } = await deps.supabase.from('menu_pairings').update(allowed)
    .eq('id', id).eq('restaurant_id', restaurantId).select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Пара не найдена')
  return data
}

export async function addManualPair(restaurantId, { dishId, pairDishId, lead, reason }) {
  if (!dishId || !pairDishId || dishId === pairDishId) throw new Error('Выберите два разных блюда')
  if (!String(lead || '').trim() || !String(reason || '').trim()) throw new Error('Заполните заголовок и пояснение')
  const { data: dishes, error: dErr } = await deps.supabase.from('menu_items').select('id')
    .eq('restaurant_id', restaurantId).in('id', [dishId, pairDishId])
  if (dErr) throw dErr
  if ((dishes || []).length !== 2) throw new Error('Блюда не из меню этого ресторана')
  const { data, error } = await deps.supabase.from('menu_pairings').upsert({
    restaurant_id: restaurantId,
    dish_id: dishId,
    pair_dish_id: pairDishId,
    rank: 0,
    lead: String(lead).trim().slice(0, 120),
    reason: String(reason).trim().slice(0, 160),
    source: 'manual',
    status: 'active',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'dish_id,pair_dish_id' }).select('id').single()
  if (error) throw error
  return data
}

export async function deletePair(restaurantId, id) {
  // Удаляем только ручные; автоматическую пару менеджер выключает (иначе она
  // вернётся при следующем расчёте).
  const { data, error } = await deps.supabase.from('menu_pairings').delete()
    .eq('id', id).eq('restaurant_id', restaurantId).eq('source', 'manual').select('id').maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Удалить можно только ручную пару — автоматическую выключите')
  return data
}
