// Раздел «Зал» в админке — чтение и запись в БД (под service_role).
// Логика расчётов — в hallCore.js.

import { supabase } from './suggestService.js'
import { normalizePhone, BOOKING_DAYS_AHEAD } from './bookingsCore.js'
import {
  DEFAULT_TZ, businessDay, businessDateOf, addDays, isDateStr, assignmentsForDate, buildSession,
  ordersOfSession, inWindow, daySummary, waiterName, reservationConflict, sanitizeLayout,
} from './hallCore.js'
import { zonesOf, assertZone } from './zonesService.js'

export const deps = { db: supabase, now: () => new Date() }

const PAGE = 1000
const CHUNK = 150

// PostgREST отдаёт не больше 1000 строк за раз — дочитываем страницами.
export async function selectAll(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

export async function selectIn(table, cols, col, ids, extra = (q) => q) {
  const uniq = [...new Set((ids || []).filter(Boolean))]
  const out = []
  for (let i = 0; i < uniq.length; i += CHUNK) {
    const chunk = uniq.slice(i, i + CHUNK)
    out.push(...await selectAll(() => extra(deps.db.from(table).select(cols).in(col, chunk))))
  }
  return out
}

export function groupBy(rows, key) {
  const m = new Map()
  for (const r of rows) {
    const k = r[key]
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

export async function restaurantOf(restaurantId) {
  const { data, error } = await deps.db.from('restaurants')
    .select('id, name, timezone').eq('id', restaurantId).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Ресторан не найден')
  return { id: data.id, name: data.name, timezone: data.timezone || DEFAULT_TZ }
}

export function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

const TABLE_COLS = 'id, number, zone, capacity, is_active, layout_x, layout_y, layout_w, layout_h, layout_shape, layout_rotation'

export async function tablesOf(restaurantId, { includeInactive = false } = {}) {
  let q = deps.db.from('tables').select(TABLE_COLS).eq('restaurant_id', restaurantId).order('number')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

export const layoutOf = (t) => (t.layout_x == null || t.layout_y == null ? null : {
  x: Number(t.layout_x), y: Number(t.layout_y),
  w: t.layout_w == null ? null : Number(t.layout_w), h: t.layout_h == null ? null : Number(t.layout_h),
  shape: t.layout_shape || null, rotation: t.layout_rotation || 0,
})

export async function waitersByIds(ids) {
  const rows = await selectIn('waiters', 'id, display_name, first_name, last_name', 'id', ids)
  return new Map(rows.map((w) => [w.id, w]))
}

// Официанты ресторана — для выбора при закреплении стола: штатные, кто уже
// закреплялся за его столами и кто выходил на смены за последние 60 дней.
export async function restaurantWaiters(restaurantId, tableIds, extraIds = []) {
  const since = addDays(new Date().toISOString().slice(0, 10), -60)
  const [staff, assigned, shifts] = await Promise.all([
    selectAll(() => deps.db.from('restaurant_staff').select('waiter_id, dismissal_date').eq('restaurant_id', restaurantId)),
    selectIn('waiter_table_assignments', 'waiter_id', 'table_id', tableIds),
    selectAll(() => deps.db.from('staff_shifts').select('waiter_id').eq('restaurant_id', restaurantId).gte('shift_date', since)),
  ])
  const ids = [...staff.filter((s) => !s.dismissal_date).map((s) => s.waiter_id), ...assigned.map((a) => a.waiter_id), ...shifts.map((s) => s.waiter_id), ...extraIds]
  return waitersByIds(ids)
}

// Сырые данные дня по набору столов: посадки, заказы, позиции, вызовы, ИИ-события.
export async function loadDay(tableIds, day, { withNames = false } = {}) {
  // Посадка могла начаться до 06:00 (ночь) — берём с запасом и фильтруем по пересечению.
  const lookback = new Date(day.from.getTime() - 12 * 3600_000).toISOString()
  const sessions = (await selectIn('table_sessions',
    'id, table_id, waiter_id, status, guest_count, started_at, ended_at, is_active, bill_type', 'table_id', tableIds,
    (q) => q.gte('started_at', lookback).lt('started_at', day.to.toISOString())))
    .filter((s) => s.started_at && (s.is_active || !s.ended_at || new Date(s.ended_at) >= day.from))
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)))

  const orders = await selectIn('orders', 'id, table_id, table_session_id, status, created_at', 'table_id', tableIds,
    (q) => q.gte('created_at', lookback).lt('created_at', day.to.toISOString()))
  const orderIds = orders.map((o) => o.id)
  const items = await selectIn('order_items', 'id, order_id, item_id, seat_number, quantity, unit_price, status, comment, sent_at, ready_at', 'order_id', orderIds)
  const mods = await selectIn('order_item_modifiers', 'order_item_id, modifier_id, price_delta', 'order_item_id', items.map((i) => i.id))
  const calls = await selectIn('waiter_calls', 'id, table_id, status, created_at, acknowledged_at, acknowledged_by, reason, kind', 'table_id', tableIds,
    (q) => q.gte('created_at', lookback).lt('created_at', day.to.toISOString()))
  const events = await selectIn('ai_suggestion_events', 'order_id, waiter_id, outcome', 'order_id', orderIds)

  let dishNames = new Map()
  let dishNorms = new Map()
  let modifierNames = new Map()
  if (withNames) {
    const dishes = await selectIn('menu_items', 'id, dish_name, cook_time_min', 'id', items.map((i) => i.item_id))
    dishNames = new Map(dishes.map((d) => [d.id, d.dish_name]))
    dishNorms = new Map(dishes.filter((d) => d.cook_time_min > 0).map((d) => [d.id, d.cook_time_min]))
    const modRows = await selectIn('modifiers', 'id, name', 'id', mods.map((m) => m.modifier_id))
    modifierNames = new Map(modRows.map((m) => [m.id, m.name]))
  }

  return {
    sessions, orders, calls,
    itemsByOrder: groupBy(items, 'order_id'),
    modsByItem: groupBy(mods, 'order_item_id'),
    eventsByOrder: groupBy(events, 'order_id'),
    dishNames, dishNorms, modifierNames,
  }
}

export function sessionContext(session, raw, extra) {
  const now = deps.now()
  const orders = ordersOfSession(session, raw.orders, { now })
  return {
    ...extra,
    now,
    orders,
    itemsByOrder: raw.itemsByOrder,
    modsByItem: raw.modsByItem,
    dishNames: raw.dishNames,
    dishNorms: raw.dishNorms,
    modifierNames: raw.modifierNames,
    calls: raw.calls.filter((c) => c.table_id === session.table_id && inWindow(c.created_at, session, { beforeMin: 0, now })),
    events: orders.flatMap((o) => raw.eventsByOrder.get(o.id) || []),
  }
}

async function assignmentRows(tableIds, dateStr) {
  return selectIn('waiter_table_assignments', 'id, waiter_id, table_id, assigned_date, is_permanent, source, created_at', 'table_id', tableIds,
    (q) => q.or(`is_permanent.eq.true,assigned_date.eq.${dateStr}`))
}

export function reservationView(r) {
  return {
    id: r.id, tableId: r.table_id, startsAt: r.starts_at, endsAt: r.ends_at, guestCount: r.guest_count,
    guestName: r.guest_name || null, guestPhone: r.guest_phone || null, comment: r.comment || null, status: r.status,
  }
}

function dateContext(restaurant, dateStr) {
  const today = businessDateOf(deps.now(), restaurant.timezone)
  const date = isDateStr(dateStr) ? dateStr : today
  const mode = date < today ? 'past' : date > today ? 'future' : 'today'
  return { date, today, mode, day: businessDay(date, restaurant.timezone) }
}

// Схема зала на дату: столы, кто закреплён, что сейчас (сегодня), итоги дня по столам, брони.
export async function getHall(restaurantId, dateStr) {
  const restaurant = await restaurantOf(restaurantId)
  const { date, today, mode, day } = dateContext(restaurant, dateStr)
  const tables = await tablesOf(restaurantId)
  const tableIds = tables.map((t) => t.id)

  const [assignRows, raw, reservations] = await Promise.all([
    assignmentRows(tableIds, date),
    mode === 'future' ? null : loadDay(tableIds, day),
    selectAll(() => deps.db.from('table_reservations')
      .select('id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, comment, status')
      .eq('restaurant_id', restaurantId)
      .gte('starts_at', day.from.toISOString()).lt('starts_at', day.to.toISOString())
      .order('starts_at')),
  ])
  const assigned = assignmentsForDate(assignRows, date)

  const zoneList = (await zonesOf(restaurantId, tables)).zones
  const sessionIds = raw ? raw.sessions.map((s) => s.waiter_id) : []
  const waiters = await restaurantWaiters(restaurantId, tableIds, [...assignRows.map((a) => a.waiter_id), ...sessionIds])

  const built = raw
    ? raw.sessions.map((s) => ({
      tableId: s.table_id,
      ...buildSession(s, sessionContext(s, raw, { waiters, assignedWaiterId: assigned.get(s.table_id)?.[0]?.waiter_id || null })),
    }))
    : []
  const byTable = groupBy(built, 'tableId')
  const resByTable = groupBy(reservations, 'table_id')

  const outTables = tables.map((t) => {
    const ts = byTable.get(t.id) || []
    const live = mode === 'today' ? ts.find((s) => s.active) || null : null
    const pendingCall = mode === 'today' && raw
      ? raw.calls.some((c) => c.table_id === t.id && c.status === 'pending')
      : false
    return {
      id: t.id, number: t.number, zone: t.zone || 'main', capacity: t.capacity, layout: layoutOf(t),
      assigned: (assigned.get(t.id) || []).map((a) => ({ id: a.id, waiterId: a.waiter_id, name: waiterName(waiters.get(a.waiter_id)), permanent: !!a.is_permanent })),
      live: live && {
        sessionId: live.id, status: live.status, guestCount: live.guestCount, startedAt: live.startedAt,
        billType: live.billType, total: live.total, waiter: live.waiter,
      },
      pendingCall,
      day: {
        sessions: ts.length,
        guests: ts.reduce((s, x) => s + (x.guestCount || 0), 0),
        revenue: ts.reduce((s, x) => s + x.total, 0),
      },
      reservations: (resByTable.get(t.id) || []).map(reservationView),
    }
  })

  return {
    restaurant, date, today, mode,
    day: { from: day.from.toISOString(), to: day.to.toISOString() },
    // Все залы ресторана по порядку (и пустые) и их названия.
    zones: zoneList.map((z) => z.key),
    zoneNames: Object.fromEntries(zoneList.map((z) => [z.key, z.name])),
    tables: outTables,
    unassignedReservations: (resByTable.get(null) || []).map(reservationView),
    waiters: [...waiters.values()].map((w) => ({ id: w.id, name: waiterName(w) })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    summary: mode === 'future' ? null : daySummary(built, tables.length),
  }
}

async function tableOf(restaurantId, tableId) {
  const { data, error } = await deps.db.from('tables').select(TABLE_COLS).eq('id', tableId).eq('restaurant_id', restaurantId).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Стол не найден')
  return data
}

// Панель стола: посадки дня целиком (заказ, вызовы, доп. продажи, отзыв) и брони вперёд.
export async function getTableDay(restaurantId, tableId, dateStr) {
  const restaurant = await restaurantOf(restaurantId)
  const { date, today, mode, day } = dateContext(restaurant, dateStr)
  const table = await tableOf(restaurantId, tableId)

  const [assignRows, raw, reservations, reviews] = await Promise.all([
    assignmentRows([tableId], date),
    mode === 'future' ? null : loadDay([tableId], day, { withNames: true }),
    selectAll(() => deps.db.from('table_reservations')
      .select('id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, comment, status')
      .eq('table_id', tableId)
      .gte('starts_at', day.from.toISOString())
      .lt('starts_at', businessDay(addDays(date, 30), restaurant.timezone).to.toISOString())
      .order('starts_at')),
    mode === 'future' ? [] : selectAll(() => deps.db.from('reviews')
      .select('rating_food, rating_service, comment, created_at, table_number')
      .eq('restaurant_id', restaurantId).eq('table_number', String(table.number))
      .gte('created_at', day.from.toISOString()).lt('created_at', new Date(day.to.getTime() + 3600_000).toISOString())),
  ])
  const assigned = assignmentsForDate(assignRows, date).get(tableId) || []
  const ackIds = raw ? raw.calls.map((c) => c.acknowledged_by) : []
  const waiters = await waitersByIds([
    ...assigned.map((a) => a.waiter_id), ...(raw ? raw.sessions.map((s) => s.waiter_id) : []), ...ackIds,
    ...(raw ? [...raw.eventsByOrder.values()].flat().map((e) => e.waiter_id) : []),
  ])

  const sessions = raw
    ? raw.sessions.map((s) => buildSession(s, {
      ...sessionContext(s, raw, { waiters, assignedWaiterId: assigned[0]?.waiter_id || null }),
      reviews: reviews.filter((r) => inWindow(r.created_at, s, { beforeMin: 0, afterMin: 60, now: deps.now() })),
    }))
    : []

  return {
    restaurant, date, today, mode,
    table: { id: table.id, number: table.number, zone: table.zone || 'main', capacity: table.capacity, layout: layoutOf(table) },
    assigned: assigned.map((a) => ({ id: a.id, waiterId: a.waiter_id, name: waiterName(waiters.get(a.waiter_id)), permanent: !!a.is_permanent })),
    sessions,
    summary: mode === 'future' ? null : daySummary(sessions, 1),
    reservations: reservations.map(reservationView),
  }
}

// ── Изменения ──

export async function saveLayout(restaurantId, layout) {
  if (!Array.isArray(layout) || layout.length === 0) throw httpError(400, 'Нет столов для сохранения')
  const own = new Set((await tablesOf(restaurantId, { includeInactive: true })).map((t) => t.id))
  for (const l of layout) {
    if (!own.has(l.id)) throw httpError(400, 'Стол не из этого ресторана')
  }
  for (const l of layout) {
    const { error } = await deps.db.from('tables').update(sanitizeLayout(l)).eq('id', l.id).eq('restaurant_id', restaurantId)
    if (error) throw error
  }
  return { saved: layout.length }
}

function tableFields(body) {
  const out = {}
  if (body.number !== undefined) {
    const n = Number(body.number)
    if (!Number.isInteger(n) || n <= 0 || n > 9999) throw httpError(400, 'Номер стола — целое число от 1')
    out.number = n
  }
  if (body.capacity !== undefined) {
    const c = Number(body.capacity)
    if (!Number.isInteger(c) || c <= 0 || c > 100) throw httpError(400, 'Число мест — от 1 до 100')
    out.capacity = c
  }
  if (body.zone !== undefined) {
    const z = String(body.zone || '').trim()
    if (!z || z.length > 40) throw httpError(400, 'Укажите зону')
    out.zone = z
  }
  if (body.isActive !== undefined) out.is_active = !!body.isActive
  return out
}

// Номер стола в ресторане один на всё время (так устроена база): занят
// столом на схеме — нельзя; занят убранным столом — при добавлении стол
// вернётся (createTable), а сменить номер на него нельзя.
async function assertFreeNumber(restaurantId, number, exceptId = null) {
  const { data, error } = await deps.db.from('tables').select('id, is_active').eq('restaurant_id', restaurantId).eq('number', number)
  if (error) throw error
  const other = (data || []).filter((t) => t.id !== exceptId)
  if (other.some((t) => t.is_active !== false)) throw httpError(409, `Стол № ${number} уже есть`)
  if (exceptId && other.length) throw httpError(409, `Номер ${number} был у стола, убранного со схемы. Выберите другой номер или добавьте стол № ${number} заново — он вернётся`)
}

// Столы для раздела «Ресторан → Столы»: залы и расстановка.
export async function getTables(restaurantId) {
  const restaurant = await restaurantOf(restaurantId)
  const tables = await tablesOf(restaurantId)
  const { zones, editable } = await zonesOf(restaurantId, tables)
  return {
    restaurant,
    zones,
    zonesEditable: editable,
    tables: tables.map((t) => ({ id: t.id, number: t.number, zone: t.zone || 'main', capacity: t.capacity, layout: layoutOf(t) })),
  }
}

export async function createTable(restaurantId, body) {
  const fields = tableFields({ zone: 'main', capacity: 4, ...body })
  if (!fields.number) throw httpError(400, 'Укажите номер стола')
  await assertZone(restaurantId, fields.zone)
  await assertFreeNumber(restaurantId, fields.number)
  // Стол с этим номером когда-то убрали со схемы — возвращаем его (номер
  // в ресторане один, а история посадок стола сохраняется).
  const { data: old, error: oldErr } = await deps.db.from('tables').select('id')
    .eq('restaurant_id', restaurantId).eq('number', fields.number).eq('is_active', false).maybeSingle()
  if (oldErr) throw oldErr
  if (old) {
    const { error } = await deps.db.from('tables')
      .update({ is_active: true, ...fields, ...sanitizeLayout(body.layout || {}) }).eq('id', old.id).eq('restaurant_id', restaurantId)
    if (error) throw error
    return { id: old.id, restored: true }
  }
  const { data, error } = await deps.db.from('tables')
    .insert({ restaurant_id: restaurantId, is_active: true, ...fields, ...sanitizeLayout(body.layout || {}) })
    .select('id').single()
  if (error) throw error
  return { id: data.id }
}

export async function updateTable(restaurantId, tableId, body) {
  await tableOf(restaurantId, tableId)
  const fields = tableFields(body)
  if (fields.zone) await assertZone(restaurantId, fields.zone)
  if (fields.number) await assertFreeNumber(restaurantId, fields.number, tableId)
  if (Object.keys(fields).length === 0) return { updated: false }
  const { error } = await deps.db.from('tables').update(fields).eq('id', tableId).eq('restaurant_id', restaurantId)
  if (error) throw error
  return { updated: true }
}

const STATUSES = new Set(['confirmed', 'seated', 'cancelled', 'no_show'])

function reservationFields(body, current = {}) {
  const merged = {
    table_id: body.tableId !== undefined ? body.tableId || null : current.table_id ?? null,
    starts_at: body.startsAt ?? current.starts_at,
    ends_at: body.endsAt ?? current.ends_at,
    guest_count: body.guestCount ?? current.guest_count,
    guest_name: body.guestName !== undefined ? String(body.guestName || '').trim().slice(0, 120) || null : current.guest_name ?? null,
    // Номер — в одном виде (+7XXXXXXXXXX), чтобы узнавать гостя по прошлым броням.
    guest_phone: body.guestPhone !== undefined ? normalizePhone(body.guestPhone) || String(body.guestPhone || '').trim().slice(0, 40) || null : current.guest_phone ?? null,
    comment: body.comment !== undefined ? String(body.comment || '').trim().slice(0, 500) || null : current.comment ?? null,
    status: body.status ?? current.status ?? 'confirmed',
  }
  const s = Date.parse(merged.starts_at)
  const e = Date.parse(merged.ends_at)
  if (Number.isNaN(s) || Number.isNaN(e)) throw httpError(400, 'Укажите время брони')
  if (e <= s) throw httpError(400, 'Конец брони раньше начала')
  if (e - s > 24 * 3600_000) throw httpError(400, 'Бронь дольше суток')
  const g = Number(merged.guest_count)
  if (!Number.isInteger(g) || g <= 0 || g > 200) throw httpError(400, 'Число гостей — от 1')
  if (!STATUSES.has(merged.status)) throw httpError(400, 'Неизвестный статус брони')
  return { ...merged, starts_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), guest_count: g }
}

const hhmm = (iso, tz) => new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

async function assertNoConflict(restaurantId, candidate) {
  if (!candidate.table_id || !(candidate.status === 'confirmed' || candidate.status === 'seated')) return
  const { data, error } = await deps.db.from('table_reservations')
    .select('id, table_id, starts_at, ends_at, status, guest_name')
    .eq('restaurant_id', restaurantId).eq('table_id', candidate.table_id)
    .lt('starts_at', candidate.ends_at).gt('ends_at', candidate.starts_at)
  if (error) throw error
  const hit = reservationConflict(candidate, data)
  if (hit) {
    const { timezone } = await restaurantOf(restaurantId)
    const who = hit.guest_name ? `${hit.guest_name}, ` : ''
    throw httpError(409, `Стол уже забронирован на это время (${who}${hhmm(hit.starts_at, timezone)}–${hhmm(hit.ends_at, timezone)})`)
  }
}

// Брони — не дальше чем на 30 дней вперёд.
async function assertBookingWindow(restaurantId, startsAt) {
  const { timezone } = await restaurantOf(restaurantId)
  const last = addDays(businessDateOf(deps.now(), timezone), BOOKING_DAYS_AHEAD)
  if (new Date(startsAt) >= businessDay(last, timezone).to) throw httpError(400, `Бронь — не дальше чем на ${BOOKING_DAYS_AHEAD} дней вперёд`)
}

export async function createReservation(restaurantId, body) {
  const fields = reservationFields(body)
  await assertBookingWindow(restaurantId, fields.starts_at)
  if (fields.table_id) await tableOf(restaurantId, fields.table_id)
  await assertNoConflict(restaurantId, fields)
  const { data, error } = await deps.db.from('table_reservations')
    .insert({ restaurant_id: restaurantId, source: 'admin', ...fields })
    .select('*').single()
  if (error) throw error
  return reservationView(data)
}

export async function updateReservation(restaurantId, id, body) {
  const { data: current, error } = await deps.db.from('table_reservations').select('*').eq('id', id).eq('restaurant_id', restaurantId).maybeSingle()
  if (error) throw error
  if (!current) throw httpError(404, 'Бронь не найдена')
  const fields = reservationFields(body, current)
  if (fields.starts_at !== new Date(current.starts_at).toISOString()) await assertBookingWindow(restaurantId, fields.starts_at)
  if (fields.table_id && fields.table_id !== current.table_id) await tableOf(restaurantId, fields.table_id)
  await assertNoConflict(restaurantId, { ...fields, id })
  const { data, error: upErr } = await deps.db.from('table_reservations').update(fields).eq('id', id).eq('restaurant_id', restaurantId).select('*').single()
  if (upErr) throw upErr
  return reservationView(data)
}

export async function deleteReservation(restaurantId, id) {
  const { error } = await deps.db.from('table_reservations').delete().eq('id', id).eq('restaurant_id', restaurantId)
  if (error) throw error
  return { deleted: true }
}

// Закрепить официанта за столом: навсегда или на дату.
export async function addAssignment(restaurantId, { tableId, waiterId, permanent, date }) {
  await tableOf(restaurantId, tableId)
  const { data: w, error: wErr } = await deps.db.from('waiters').select('id').eq('id', waiterId).maybeSingle()
  if (wErr) throw wErr
  if (!w) throw httpError(404, 'Официант не найден')
  if (!permanent && !isDateStr(date)) throw httpError(400, 'Укажите дату закрепления')
  const { data, error } = await deps.db.from('waiter_table_assignments')
    .insert({ table_id: tableId, waiter_id: waiterId, is_permanent: !!permanent, assigned_date: permanent ? deps.now().toISOString().slice(0, 10) : date })
    .select('id').single()
  if (error) throw error
  return { id: data.id }
}

export async function removeAssignment(restaurantId, id) {
  const { data, error } = await deps.db.from('waiter_table_assignments').select('id, table_id').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Закрепление не найдено')
  await tableOf(restaurantId, data.table_id)
  const { error: delErr } = await deps.db.from('waiter_table_assignments').delete().eq('id', id)
  if (delErr) throw delErr
  return { deleted: true }
}
