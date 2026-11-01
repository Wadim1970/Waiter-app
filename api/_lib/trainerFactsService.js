// Контент-студия тренажёра — чтение и запись в БД (под service_role).
// Логика — trainerFactsCore.js. Меню берём из menu_items как есть (одно
// меню на гостя, официанта и тренажёр), факты — в trn_dish_facts.
//
// Пока в админке нет входа, «кто подтвердил» — имя, которое ввели в студии
// (actor). Оно не проверено; когда появится вход, actor берётся из сессии.

import { deps, selectAll, selectIn, restaurantOf, groupBy, httpError } from './hallService.js'
import { requireUuid } from './adminRoute.js'
import { dishView, popularTwins, isPopular } from './menuCore.js'
import { deepseekChat as realDeepseek, DEEPSEEK_KEY } from './suggestService.js'
import {
  FACT_TYPES, FACT_TYPE_KEYS, ALLERGENS, STATUSES, LEVELS, BATCH_FACT_TYPES,
  validateFact, planSync, deriveMenuFacts, menuHash, readiness, allergenHints, batchCandidates,
  parseAiDrafts, buildAiDraftMessages, hashOf,
} from './trainerFactsCore.js'

export const aiDeps = { deepseekChat: realDeepseek, hasKey: () => !!DEEPSEEK_KEY }

const SYSTEM_ACTOR = 'система'

const MENU_COLS = 'id, dish_name, menu_section, section_order, cost_rub, product_type, weight_g, specific_details, cook_time_min, description, ingredients, nutritional_info, tags, image_url, image_url_thumbnail, is_hidden, is_available, stop_until, course_role, meal_times'

const nowIso = () => deps.now().toISOString()

function actorOf(body) {
  const a = String(body?.actor ?? '').replace(/\s+/g, ' ').trim()
  if (a.length < 2 || a.length > 60) throw httpError(400, 'Укажите, кто работает в студии (имя от 2 символов) — оно попадёт в журнал подтверждений')
  return a
}

// ── Чтение меню ──────────────────────────────────────────────────────────

// Блюда для обучения: без копий в «Популярном» (одно блюдо — одна запись).
async function menuRows(restaurantId) {
  const rows = await selectAll(() => deps.db.from('menu_items').select(MENU_COLS).eq('restaurant_id', restaurantId)
    .order('section_order', { ascending: true }).order('dish_name', { ascending: true }))
  const twin = popularTwins(rows)
  return rows.filter((r) => !(isPopular(r.menu_section) && twin.has(r.id)))
}

async function modifiersOf(itemIds) {
  const groups = await selectIn('modifier_groups', 'id, item_id, name, sort_order', 'item_id', itemIds)
  const mods = groupBy(await selectIn('modifiers', 'id, group_id, name, is_available, sort_order', 'group_id', groups.map((g) => g.id)), 'group_id')
  const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  return groupBy(groups.sort(byOrder).map((g) => ({
    itemId: g.item_id,
    name: g.name,
    options: (mods.get(g.id) || []).filter((m) => m.is_available !== false).sort(byOrder).map((m) => ({ name: m.name })),
  })), 'itemId')
}

async function factsOf(restaurantId) {
  return selectAll(() => deps.db.from('trn_dish_facts').select('*').eq('restaurant_id', restaurantId))
}

const byType = (facts) => Object.fromEntries(facts.map((f) => [f.fact_type, f]))

async function dishOf(restaurantId, dishId) {
  requireUuid(dishId, 'dishId')
  const { data, error } = await deps.db.from('menu_items').select(MENU_COLS).eq('id', dishId).eq('restaurant_id', restaurantId).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Блюдо не найдено')
  const mods = await modifiersOf([dishId])
  return { row: data, groups: (mods.get(dishId) || []).map(({ itemId, ...g }) => g) }
}

async function audit(rows) {
  if (!rows.length) return
  const { error } = await deps.db.from('trn_fact_audit_log').insert(rows)
  if (error) throw error
}

const auditRow = (restaurantId, dishId, factType, action, actor, before, after) => ({
  restaurant_id: restaurantId, dish_id: dishId, fact_type: factType, action, actor,
  old_status: before?.status ?? null, new_status: after?.status ?? null,
  old_value: before?.value ?? null, new_value: after?.value ?? null,
})

// ── Синхронизация с меню ─────────────────────────────────────────────────
// Создаёт черновики из данных меню для блюд, у которых их ещё нет, и
// возвращает в draft подтверждённые факты, чьи данные в меню изменились.
export async function syncFacts(restaurantId) {
  await restaurantOf(restaurantId)
  const rows = await menuRows(restaurantId)
  const mods = await modifiersOf(rows.map((r) => r.id))
  const facts = groupBy(await factsOf(restaurantId), 'dish_id')
  const inserts = []
  const logs = []
  let reset = 0
  let refreshed = 0
  for (const row of rows) {
    const existing = byType(facts.get(row.id) || [])
    const groups = (mods.get(row.id) || []).map(({ itemId, ...g }) => g)
    const plan = planSync(row, groups, existing)
    for (const ins of plan.inserts) {
      inserts.push({ restaurant_id: restaurantId, dish_id: row.id, status: 'draft', ...ins })
      logs.push(auditRow(restaurantId, row.id, ins.fact_type, 'seed', SYSTEM_ACTOR, null, { status: 'draft', value: ins.value }))
    }
    for (const up of plan.updates) {
      const cur = existing[up.fact_type]
      const { error } = await deps.db.from('trn_dish_facts').update({ ...up.fields, updated_at: nowIso() }).eq('id', up.id)
      if (error) throw error
      if (up.action === 'menu_changed') reset++
      else refreshed++
      logs.push(auditRow(restaurantId, row.id, up.fact_type, up.action, SYSTEM_ACTOR, cur, { status: up.fields.status ?? cur.status, value: up.fields.value ?? cur.value }))
    }
  }
  if (inserts.length) {
    const { error } = await deps.db.from('trn_dish_facts').insert(inserts)
    if (error) throw error
  }
  await audit(logs)
  return { dishes: rows.length, created: inserts.length, returnedToDraft: reset, refreshed }
}

// ── Список блюд с готовностью ────────────────────────────────────────────
export async function getStudio(restaurantId) {
  const restaurant = await restaurantOf(restaurantId)
  const rows = await menuRows(restaurantId)
  const facts = groupBy(await factsOf(restaurantId), 'dish_id')

  const sections = new Map()
  const dishes = rows.map((r) => {
    const mine = facts.get(r.id) || []
    const map = byType(mine)
    const ready = readiness(r, map)
    const statuses = Object.fromEntries(mine.map((f) => [f.fact_type, f.status]))
    const review = mine.filter((f) => f.review_note).map((f) => f.fact_type)
    const name = r.menu_section || 'Без раздела'
    const s = sections.get(name) || { name, order: r.section_order ?? 9999, dishes: 0, ready: { 1: 0, 2: 0, 3: 0 }, applicable: { 1: 0, 2: 0, 3: 0 }, drafts: 0 }
    s.dishes++
    for (const lv of LEVELS) {
      if (ready[lv].ready !== null) s.applicable[lv]++
      if (ready[lv].ready) s.ready[lv]++
    }
    s.drafts += mine.filter((f) => f.status === 'draft').length
    sections.set(name, s)
    return {
      id: r.id,
      name: r.dish_name,
      section: name,
      sectionOrder: r.section_order ?? null,
      productType: r.product_type || 'food',
      price: Number(r.cost_rub || 0),
      hidden: !!r.is_hidden,
      available: r.is_available !== false,
      thumbUrl: r.image_url_thumbnail || r.image_url || '',
      ready,
      statuses,
      review,
    }
  })
  return {
    restaurant,
    sections: [...sections.values()].sort((a, b) => a.order - b.order),
    dishes,
    meta: {
      statuses: STATUSES,
      factTypes: FACT_TYPE_KEYS.map((k) => ({ key: k, label: FACT_TYPES[k].label, na: FACT_TYPES[k].na, ai: FACT_TYPES[k].ai, batch: FACT_TYPES[k].batch })),
      allergens: ALLERGENS.map(({ code, name }) => ({ code, name })),
      batchTypes: BATCH_FACT_TYPES,
    },
  }
}

// ── Карточка блюда ───────────────────────────────────────────────────────
export async function getDish(restaurantId, dishId) {
  const { row, groups } = await dishOf(restaurantId, dishId)
  const view = dishView(row, { modifiers: groups })
  const facts = await selectAll(() => deps.db.from('trn_dish_facts').select('*').eq('restaurant_id', restaurantId).eq('dish_id', dishId))
  const map = byType(facts)
  const { data: log, error } = await deps.db.from('trn_fact_audit_log').select('*').eq('restaurant_id', restaurantId).eq('dish_id', dishId)
    .order('created_at', { ascending: false }).limit(40)
  if (error) throw error
  const alcohol = (await menuRows(restaurantId)).filter((r) => r.product_type === 'alcohol').map((r) => ({ id: r.id, name: r.dish_name }))
  return {
    dish: {
      id: view.id, name: view.name, section: view.section, productType: view.productType, description: view.description,
      ingredients: view.ingredients, weight: view.weight, cookTimeMin: view.cookTimeMin, imageUrl: view.imageUrl, hidden: view.hidden,
    },
    facts: facts.map((f) => ({
      type: f.fact_type, value: f.value, status: f.status, source: f.source, reviewNote: f.review_note || null,
      confirmedBy: f.confirmed_by || null, confirmedAt: f.confirmed_at || null, updatedAt: f.updated_at || null,
    })),
    ready: readiness(row, map),
    allergenHints: allergenHints(view.ingredients, `${view.name}. ${view.description}`),
    alcohol,
    log: (log || []).map((l) => ({ at: l.created_at, type: l.fact_type, action: l.action, actor: l.actor, from: l.old_status, to: l.new_status })),
  }
}

// ── Запись факта ─────────────────────────────────────────────────────────
async function checkWineIds(restaurantId, ids) {
  const rows = await selectIn('menu_items', 'id, product_type', 'id', ids, (q) => q.eq('restaurant_id', restaurantId))
  const ok = new Set(rows.filter((r) => r.product_type === 'alcohol').map((r) => r.id))
  if (ids.some((id) => !ok.has(id))) throw httpError(400, 'Винная пара — только алкогольные позиции этого ресторана')
}

// Сохранить значение факта (черновик) или сохранить и сразу подтвердить.
export async function saveFact(restaurantId, body) {
  const actor = actorOf(body)
  const type = String(body.factType || '')
  if (!FACT_TYPES[type]) throw httpError(400, 'Неизвестный тип факта')
  const { row, groups } = await dishOf(restaurantId, String(body.dishId || ''))
  const checked = validateFact(type, body.value)
  if (!checked.ok) throw httpError(400, checked.error)
  if (type === 'wine_pairing' && !checked.value.na) await checkWineIds(restaurantId, checked.value.item_ids)

  const { data: cur, error: e1 } = await deps.db.from('trn_dish_facts').select('*').eq('dish_id', row.id).eq('fact_type', type).maybeSingle()
  if (e1) throw e1
  const confirm = body.confirm === true
  const now = nowIso()
  const same = cur && hashOf(cur.value) === hashOf(checked.value)
  const fields = {
    value: checked.value,
    status: confirm ? 'confirmed' : 'draft',
    // Значение не менялось — источник сохраняем (сидированное из меню/ИИ остаётся таким и при подтверждении).
    source: same ? cur.source : 'manual',
    review_note: null,
    confirmed_by: confirm ? actor : null,
    confirmed_at: confirm ? now : null,
    updated_at: now,
  }
  if (FACT_TYPES[type].menu) {
    // Отпечаток меню на момент сохранения: дальше сравниваем с ним.
    fields.source_hash = menuHash(type, deriveMenuFacts(row, groups)[type] || null)
  }
  let saved
  if (cur) {
    const { data, error } = await deps.db.from('trn_dish_facts').update(fields).eq('id', cur.id).select().single()
    if (error) throw error
    saved = data
  } else {
    const { data, error } = await deps.db.from('trn_dish_facts').insert({ restaurant_id: restaurantId, dish_id: row.id, fact_type: type, ...fields }).select().single()
    if (error) throw error
    saved = data
  }
  await audit([auditRow(restaurantId, row.id, type, confirm ? 'confirm' : 'edit', actor, cur, saved)])
  return { ok: true, status: saved.status }
}

// confirm / reject / reset существующего факта без правки значения.
export async function setFactStatus(restaurantId, body) {
  const actor = actorOf(body)
  const type = String(body.factType || '')
  const action = String(body.action || '')
  if (!FACT_TYPES[type]) throw httpError(400, 'Неизвестный тип факта')
  if (!['confirm', 'reject', 'reset'].includes(action)) throw httpError(400, 'Неизвестное действие')
  const { row } = await dishOf(restaurantId, String(body.dishId || ''))
  const { data: cur, error } = await deps.db.from('trn_dish_facts').select('*').eq('dish_id', row.id).eq('fact_type', type).maybeSingle()
  if (error) throw error
  if (!cur) throw httpError(404, 'Факта ещё нет — сначала заполните его')
  if (action === 'confirm') {
    const checked = validateFact(type, cur.value)
    if (!checked.ok) throw httpError(400, checked.error)
  }
  const now = nowIso()
  const status = action === 'confirm' ? 'confirmed' : action === 'reject' ? 'rejected' : 'draft'
  const fields = {
    status,
    review_note: action === 'reset' ? cur.review_note : null,
    confirmed_by: status === 'confirmed' ? actor : null,
    confirmed_at: status === 'confirmed' ? now : null,
    updated_at: now,
  }
  const { error: e2 } = await deps.db.from('trn_dish_facts').update(fields).eq('id', cur.id)
  if (e2) throw e2
  await audit([auditRow(restaurantId, row.id, type, action, actor, cur, { status, value: cur.value })])
  return { ok: true, status }
}

// Пакетное подтверждение простых фактов по разделу меню.
export async function batchConfirm(restaurantId, body) {
  const actor = actorOf(body)
  const type = String(body.factType || '')
  if (type === 'allergens' || type === 'may_contain') throw httpError(400, 'Аллергены подтверждаются только по одному блюду')
  if (!BATCH_FACT_TYPES.includes(type)) throw httpError(400, 'Этот факт нельзя подтверждать пакетно')
  const section = String(body.section || '').trim()
  if (!section) throw httpError(400, 'Выберите раздел меню')
  const rows = (await menuRows(restaurantId)).filter((r) => (r.menu_section || 'Без раздела') === section)
  const ids = new Set(rows.map((r) => r.id))
  const all = (await factsOf(restaurantId)).filter((f) => ids.has(f.dish_id))
  const todo = batchCandidates(type, all)
  const skipped = all.filter((f) => f.fact_type === type && f.status === 'draft').length - todo.length
  const now = nowIso()
  const logs = []
  for (const f of todo) {
    const { error } = await deps.db.from('trn_dish_facts').update({ status: 'confirmed', confirmed_by: actor, confirmed_at: now, updated_at: now }).eq('id', f.id)
    if (error) throw error
    logs.push(auditRow(restaurantId, f.dish_id, type, 'batch_confirm', actor, f, { status: 'confirmed', value: f.value }))
  }
  await audit(logs)
  return { confirmed: todo.length, skipped }
}

// ── Черновики ИИ ─────────────────────────────────────────────────────────
// Заполняет ТОЛЬКО пустые факты: подтверждённое, введённое шефом и взятое
// из меню не трогает. Всё остаётся черновиком до подтверждения шефом.
export async function aiDraft(restaurantId, body) {
  const actor = actorOf(body)
  if (!aiDeps.hasKey()) throw httpError(503, 'ИИ не подключён: на сервере нет ключа DeepSeek')
  const { row, groups } = await dishOf(restaurantId, String(body.dishId || ''))
  const view = dishView(row, { modifiers: groups })
  const messages = buildAiDraftMessages(view)
  let drafts = null
  for (let attempt = 0; attempt < 2 && !drafts; attempt++) {
    const raw = await aiDeps.deepseekChat(messages, { maxTokens: 600, timeoutMs: 20000, temperature: 0.2 }).catch(() => null)
    drafts = parseAiDrafts(raw)
  }
  if (!drafts) throw httpError(502, 'ИИ ответил в неверном формате. Попробуйте ещё раз или заполните факты вручную')

  const existing = byType(await selectAll(() => deps.db.from('trn_dish_facts').select('*').eq('dish_id', row.id)))
  const created = []
  const logs = []
  const now = nowIso()
  for (const [type, value] of Object.entries(drafts)) {
    const cur = existing[type]
    if (cur && !(cur.source === 'ai' && cur.status !== 'confirmed')) continue
    const fields = { value, status: 'draft', source: 'ai', review_note: null, confirmed_by: null, confirmed_at: null, updated_at: now }
    if (FACT_TYPES[type].menu) fields.source_hash = menuHash(type, deriveMenuFacts(row, groups)[type] || null)
    if (cur) {
      const { error } = await deps.db.from('trn_dish_facts').update(fields).eq('id', cur.id)
      if (error) throw error
    } else {
      const { error } = await deps.db.from('trn_dish_facts').insert({ restaurant_id: restaurantId, dish_id: row.id, fact_type: type, ...fields })
      if (error) throw error
    }
    created.push(type)
    logs.push(auditRow(restaurantId, row.id, type, 'ai_draft', actor, cur, { status: 'draft', value }))
  }
  await audit(logs)
  return { created }
}
