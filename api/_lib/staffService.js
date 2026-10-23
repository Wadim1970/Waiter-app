// Раздел «Официанты» в админке — чтение из БД (под service_role).
// Посадки за период собираются так же, как история стола в «Зале»
// (hallService), и раскладываются по официантам: записанный в посадке →
// работавший с ИИ-подсказками по её заказам → закреплённый за столом в тот день.

import {
  deps, selectAll, restaurantOf, tablesOf, waitersByIds, restaurantWaiters, loadDay, sessionContext, groupBy, httpError,
} from './hallService.js'
import { businessDay, businessDateOf, assignmentsForDate, buildSession, inWindow, waiterName } from './hallCore.js'
import { normalizePeriod, aggregate, upsellStats, byDay, tablesSummary, workDays } from './staffCore.js'

async function loadPeriod(restaurantId, fromStr, toStr) {
  const restaurant = await restaurantOf(restaurantId)
  const tz = restaurant.timezone
  const today = businessDateOf(deps.now(), tz)
  const period = normalizePeriod(fromStr, toStr, today)
  const range = { from: businessDay(period.from, tz).from, to: businessDay(period.to, tz).to }
  const tables = await tablesOf(restaurantId, { includeInactive: true })
  const tableIds = tables.map((t) => t.id)
  const tableById = new Map(tables.map((t) => [t.id, t]))

  const [raw, assignRows, events, dishRows, shifts, reviews, waiterReviews] = await Promise.all([
    loadDay(tableIds, range),
    selectAll(() => deps.db.from('waiter_table_assignments')
      .select('id, waiter_id, table_id, assigned_date, is_permanent, created_at')
      .in('table_id', tableIds.length ? tableIds : ['00000000-0000-0000-0000-000000000000'])
      .or(`is_permanent.eq.true,assigned_date.gte.${period.from}`)),
    selectAll(() => deps.db.from('ai_suggestion_events')
      .select('waiter_id, dish_id, category, technique, outcome, created_at, channel')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', range.from.toISOString()).lt('created_at', range.to.toISOString())),
    selectAll(() => deps.db.from('menu_items').select('id, dish_name, cost_rub').eq('restaurant_id', restaurantId)),
    selectAll(() => deps.db.from('staff_shifts').select('waiter_id, shift_date')
      .eq('restaurant_id', restaurantId).gte('shift_date', period.from).lte('shift_date', period.to)),
    selectAll(() => deps.db.from('reviews').select('rating_service, rating_food, comment, created_at, table_number')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', range.from.toISOString()).lt('created_at', new Date(range.to.getTime() + 3600_000).toISOString())),
    selectAll(() => deps.db.from('reviews_waiter').select('waiter_id, rating, created_at')
      .eq('restaurant_id', restaurantId)
      .gte('created_at', range.from.toISOString()).lt('created_at', range.to.toISOString())),
  ])

  const assigned = assignRows.filter((a) => a.is_permanent || a.assigned_date <= period.to)
  // Имена — для «кто подошёл на вызов» в посадках.
  const waiters = await waitersByIds([
    ...raw.sessions.map((s) => s.waiter_id), ...raw.calls.map((c) => c.acknowledged_by),
    ...assigned.map((a) => a.waiter_id), ...events.map((e) => e.waiter_id),
  ])

  // Закрепления на каждую дату периода — один раз на дату.
  const assignedByDate = new Map()
  const assignedOn = (date) => {
    if (!assignedByDate.has(date)) assignedByDate.set(date, assignmentsForDate(assigned, date))
    return assignedByDate.get(date)
  }

  const reviewsByTable = groupBy(reviews, 'table_number')
  const sessions = raw.sessions
    .map((s) => ({ s, date: businessDateOf(new Date(s.started_at), tz) }))
    .filter(({ date }) => date >= period.from && date <= period.to)
    .map(({ s, date }) => {
      const table = tableById.get(s.table_id)
      const built = buildSession(s, {
        ...sessionContext(s, raw, { waiters, assignedWaiterId: assignedOn(date).get(s.table_id)?.[0]?.waiter_id || null }),
        reviews: (reviewsByTable.get(String(table?.number)) || []).filter((r) => inWindow(r.created_at, s, { beforeMin: 0, afterMin: 60, now: deps.now() })),
      })
      return { ...built, date, tableId: s.table_id, tableNumber: table?.number ?? null }
    })

  // Только подсказки официантам (у гостевого меню — свои события).
  const waiterEvents = events
    .filter((e) => e.waiter_id && e.channel !== 'guest_menu')
    .map((e) => ({ ...e, date: businessDateOf(new Date(e.created_at), tz) }))
  const dishes = new Map(dishRows.map((d) => [d.id, { name: d.dish_name, price: Number(d.cost_rub || 0) }]))

  return {
    restaurant, today, period, tables, tableIds, sessions, events: waiterEvents, dishes, shifts, waiterReviews, assignRows: assigned,
  }
}

function ratingOf(rows) {
  const r = rows.map((x) => Number(x.rating)).filter((x) => x > 0)
  return r.length ? Math.round((r.reduce((a, b) => a + b, 0) / r.length) * 10) / 10 : null
}

function metricsFor(waiterId, data) {
  const sessions = data.sessions.filter((s) => s.waiter.id === waiterId)
  const events = data.events.filter((e) => e.waiter_id === waiterId)
  const shiftDates = data.shifts.filter((s) => s.waiter_id === waiterId).map((s) => s.shift_date)
  const days = workDays(shiftDates, sessions.map((s) => s.date))
  const a = aggregate(sessions)
  const u = upsellStats(events, data.dishes)
  return {
    ...a,
    workDays: days,
    revenuePerDay: days ? Math.round(a.revenue / days) : 0,
    upsell: u,
    upsellPerSession: a.sessions ? Math.round((u.offered / a.sessions) * 10) / 10 : 0,
    rating: ratingOf(data.waiterReviews.filter((r) => r.waiter_id === waiterId)),
    tables: tablesSummary(sessions).map((t) => t.number).filter((n) => n != null),
    sessionsList: sessions,
  }
}

function restaurantMetrics(data, waiterIds) {
  const a = aggregate(data.sessions)
  const u = upsellStats(data.events, data.dishes)
  const attributed = data.sessions.filter((s) => s.waiter.id)
  const totalDays = waiterIds.reduce((n, id) => n + workDays(
    data.shifts.filter((s) => s.waiter_id === id).map((s) => s.shift_date),
    attributed.filter((s) => s.waiter.id === id).map((s) => s.date),
  ), 0)
  const attributedRevenue = attributed.reduce((s, x) => s + x.total, 0)
  return {
    ...a,
    upsell: { offered: u.offered, accepted: u.accepted, rate: u.rate, revenue: u.revenue },
    upsellPerSession: a.sessions ? Math.round((u.offered / a.sessions) * 10) / 10 : 0,
    revenuePerDay: totalDays ? Math.round(attributedRevenue / totalDays) : 0,
    unattributed: {
      sessions: data.sessions.length - attributed.length,
      revenue: data.sessions.filter((s) => !s.waiter.id).reduce((s, x) => s + x.total, 0),
    },
  }
}

function strip(m) {
  const rest = { ...m }
  delete rest.sessionsList
  return rest
}

// Список официантов за период и средние по ресторану.
export async function getStaff(restaurantId, from, to) {
  const data = await loadPeriod(restaurantId, from, to)
  const active = new Set([
    ...data.sessions.map((s) => s.waiter.id), ...data.events.map((e) => e.waiter_id), ...data.shifts.map((s) => s.waiter_id),
  ].filter(Boolean))
  const known = await restaurantWaiters(restaurantId, data.tableIds, [...active])
  const rows = [...known.values()].map((w) => ({
    id: w.id,
    name: waiterName(w),
    ...strip(metricsFor(w.id, data)),
  }))
  // Сначала работавшие в периоде, по выручке.
  rows.sort((a, b) => (b.sessions > 0) - (a.sessions > 0) || b.revenue - a.revenue || a.name.localeCompare(b.name, 'ru'))
  return {
    restaurant: data.restaurant,
    today: data.today,
    period: { from: data.period.from, to: data.period.to, days: data.period.days.length },
    restaurantTotals: restaurantMetrics(data, [...active]),
    waiters: rows,
  }
}

// Карточка официанта за период.
export async function getWaiterStats(restaurantId, waiterId, from, to) {
  const data = await loadPeriod(restaurantId, from, to)
  const { data: w, error } = await deps.db.from('waiters')
    .select('id, display_name, first_name, last_name, employment_type, restaurant_id, rating, personal_photo_1_url, hire_date')
    .eq('id', waiterId).maybeSingle()
  if (error) throw error
  if (!w) throw httpError(404, 'Официант не найден')
  const m = metricsFor(waiterId, data)
  const worked = m.sessions > 0 || data.events.some((e) => e.waiter_id === waiterId)
    || data.shifts.some((s) => s.waiter_id === waiterId) || data.assignRows.some((a) => a.waiter_id === waiterId)
  if (!worked && w.restaurant_id !== restaurantId) {
    // Официант этого ресторана ни разу не касался — не показываем чужих.
    const known = await restaurantWaiters(restaurantId, data.tableIds, [])
    if (!known.has(waiterId)) throw httpError(404, 'Официант не работал в этом ресторане')
  }

  const allIds = [...new Set(data.sessions.map((s) => s.waiter.id).filter(Boolean))]

  return {
    restaurant: data.restaurant,
    today: data.today,
    period: { from: data.period.from, to: data.period.to, days: data.period.days.length },
    waiter: {
      id: w.id,
      name: waiterName(w),
      employmentType: w.employment_type || null,
      staff: w.restaurant_id === restaurantId,
      photo: w.personal_photo_1_url || null,
      hireDate: w.hire_date || null,
    },
    totals: strip(m),
    restaurantTotals: restaurantMetrics(data, allIds),
    byDay: byDay(m.sessionsList, data.events.filter((e) => e.waiter_id === waiterId), data.period.days),
    tables: tablesSummary(m.sessionsList),
    sessions: [...m.sessionsList].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))).slice(0, 300),
  }
}
