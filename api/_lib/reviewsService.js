// Раздел «Жалобы и оценки» — чтение и запись (под service_role).
// Отзыв гостя (reviews) хранит номер стола и время; посадку, официанта и чек
// находим по столу и времени — как в истории стола.

import { deps, selectAll, selectIn, restaurantOf, tablesOf, waitersByIds, httpError } from './hallService.js'
import { businessDay, businessDateOf, assignmentsForDate, waiterName, inWindow } from './hallCore.js'
import { normalizePeriod } from './staffCore.js'
import { classify, summarize, byWaiter, byDay } from './reviewsCore.js'

export async function getReviews(restaurantId, fromStr, toStr) {
  const restaurant = await restaurantOf(restaurantId)
  const tz = restaurant.timezone
  const today = businessDateOf(deps.now(), tz)
  const period = normalizePeriod(fromStr, toStr, today)
  const range = { from: businessDay(period.from, tz).from, to: businessDay(period.to, tz).to }

  const rows = await selectAll(() => deps.db.from('reviews')
    .select('id, created_at, table_number, rating_food, rating_service, comment, resolved_at, resolved_note')
    .eq('restaurant_id', restaurantId)
    .gte('created_at', range.from.toISOString()).lt('created_at', range.to.toISOString())
    .order('created_at', { ascending: false }))

  // Посадка, к которой относится отзыв: стол по номеру, отзыв — во время
  // посадки или в течение часа после её закрытия.
  const tables = await tablesOf(restaurantId, { includeInactive: true })
  const tableByNumber = new Map(tables.map((t) => [String(t.number), t]))
  const tableIds = [...new Set(rows.map((r) => tableByNumber.get(String(r.table_number))?.id).filter(Boolean))]
  const lookback = new Date(range.from.getTime() - 12 * 3600_000).toISOString()
  const [sessions, assignRows] = await Promise.all([
    selectIn('table_sessions', 'id, table_id, waiter_id, guest_count, started_at, ended_at, is_active', 'table_id', tableIds,
      (q) => q.gte('started_at', lookback).lt('started_at', range.to.toISOString())),
    selectIn('waiter_table_assignments', 'id, waiter_id, table_id, assigned_date, is_permanent, created_at', 'table_id', tableIds,
      (q) => q.or(`is_permanent.eq.true,assigned_date.gte.${period.from}`)),
  ])
  const now = deps.now()
  const linked = rows.map((r) => {
    const table = tableByNumber.get(String(r.table_number))
    const date = businessDateOf(new Date(r.created_at), tz)
    const session = table
      ? sessions.filter((s) => s.table_id === table.id && inWindow(r.created_at, s, { beforeMin: 0, afterMin: 60, now }))
        .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0]
      : null
    const waiterId = session?.waiter_id
      || (table ? assignmentsForDate(assignRows.filter((a) => a.is_permanent || a.assigned_date <= period.to), date).get(table.id)?.[0]?.waiter_id : null)
      || null
    return { r, table, date, session, waiterId, inferred: !session?.waiter_id && !!waiterId }
  })
  const waiters = await waitersByIds(linked.map((l) => l.waiterId))

  const reviews = linked.map(({ r, table, date, session, waiterId, inferred }) => ({
    id: r.id,
    createdAt: r.created_at,
    date,
    tableNumber: r.table_number ?? null,
    tableId: table?.id ?? null,
    comment: (r.comment || '').trim() || null,
    ...classify(r),
    resolvedAt: r.resolved_at || null,
    resolvedNote: r.resolved_note || null,
    session: session ? { id: session.id, startedAt: session.started_at, endedAt: session.ended_at, guestCount: session.guest_count } : null,
    waiter: waiterId ? { id: waiterId, name: waiterName(waiters.get(waiterId)), inferred } : null,
  }))

  return {
    restaurant,
    today,
    period: { from: period.from, to: period.to, days: period.days.length },
    summary: summarize(reviews),
    byWaiter: byWaiter(reviews),
    byDay: byDay(reviews, period.days),
    reviews,
  }
}

// Жалоба разобрана (или снова открыта).
export async function resolveReview(restaurantId, { id, resolved, note }) {
  const { data, error } = await deps.db.from('reviews').select('id').eq('id', id).eq('restaurant_id', restaurantId).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Отзыв не найден')
  const fields = resolved
    ? { resolved_at: deps.now().toISOString(), resolved_note: String(note || '').trim().slice(0, 500) || null }
    : { resolved_at: null, resolved_note: null }
  const { error: upErr } = await deps.db.from('reviews').update(fields).eq('id', id).eq('restaurant_id', restaurantId)
  if (upErr) throw upErr
  return { id, resolvedAt: fields.resolved_at, resolvedNote: fields.resolved_note }
}
