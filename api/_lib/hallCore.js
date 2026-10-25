// Раздел «Зал» в админке — ЧИСТАЯ логика (без БД и сети, юнит-тестируется):
// границы дня ресторана, чек посадки, сборка истории стола и сводки дня.
// Ввод/вывод — в hallService.js.

// День ресторана начинается в 06:00 по его времени: ночные посадки до утра
// относятся к вечеру, а не к следующей дате.
export const DAY_START_HOUR = 6
export const DEFAULT_TZ = 'Europe/Moscow'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const isDateStr = (s) => DATE_RE.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

// Смещение часового пояса (минуты, «местное − UTC») в момент instant.
export function tzOffsetMinutes(tz, instant) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant)
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second)
  return Math.round((asUtc - instant.getTime()) / 60000)
}

// Местное время «дата + час» → момент UTC (с учётом перехода на летнее время).
export function zonedTime(dateStr, hour, tz) {
  const naive = Date.parse(`${dateStr}T${String(hour).padStart(2, '0')}:00:00Z`)
  let t = naive - tzOffsetMinutes(tz, new Date(naive)) * 60000
  t = naive - tzOffsetMinutes(tz, new Date(t)) * 60000
  return new Date(t)
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Границы дня ресторана: [06:00 даты; 06:00 следующей даты) по его времени.
export function businessDay(dateStr, tz = DEFAULT_TZ, startHour = DAY_START_HOUR) {
  return { from: zonedTime(dateStr, startHour, tz), to: zonedTime(addDays(dateStr, 1), startHour, tz) }
}

// К какому дню ресторана относится момент (для «сегодня»).
export function businessDateOf(instant, tz = DEFAULT_TZ, startHour = DAY_START_HOUR) {
  const local = new Date(instant.getTime() + tzOffsetMinutes(tz, instant) * 60000)
  local.setUTCHours(local.getUTCHours() - startHour)
  return local.toISOString().slice(0, 10)
}

// Чек заказа: Σ qty × (цена + наценки модификаторов) — как place_guest_order.
export function orderItemsTotal(items, modsByItem = new Map()) {
  let sum = 0
  for (const it of items || []) {
    const delta = (modsByItem.get(it.id) || []).reduce((s, m) => s + Number(m.price_delta || 0), 0)
    sum += Number(it.quantity || 0) * (Number(it.unit_price || 0) + delta)
  }
  return Math.round(sum)
}

export function waiterName(w) {
  if (!w) return null
  const full = [w.first_name, w.last_name].filter(Boolean).join(' ').trim()
  return (w.display_name || full || 'Без имени').trim()
}

// Кто обслуживал посадку: записанный в посадке → тот, кто работал с
// ИИ-подсказками по её заказам → закреплённый за столом на этот день.
// inferred — «не записано, а выведено» (админка помечает это).
export function resolveSessionWaiter(session, { eventWaiterIds = [], assignedWaiterId = null } = {}) {
  if (session.waiter_id) return { id: session.waiter_id, inferred: false }
  const fromEvents = eventWaiterIds.find(Boolean)
  if (fromEvents) return { id: fromEvents, inferred: true }
  if (assignedWaiterId) return { id: assignedWaiterId, inferred: true }
  return { id: null, inferred: false }
}

// Закреплённые за столами на дату: на дату важнее «навсегда», затем последний назначенный.
// Галочка официанта (source = 'self') действует со дня, когда он её поставил, —
// в прошлые дни стол за ним не числится.
export function assignmentsForDate(rows, dateStr) {
  const byTable = new Map()
  const sorted = [...(rows || [])]
    .filter((a) => a.source === 'self' ? a.assigned_date <= dateStr : (a.is_permanent || a.assigned_date === dateStr))
    .sort((a, b) => (a.is_permanent === b.is_permanent ? String(b.created_at).localeCompare(String(a.created_at)) : a.is_permanent ? 1 : -1))
  for (const a of sorted) {
    if (!byTable.has(a.table_id)) byTable.set(a.table_id, [])
    const list = byTable.get(a.table_id)
    if (!list.some((x) => x.waiter_id === a.waiter_id)) list.push(a)
  }
  return byTable
}

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000))

// Полная посадка для истории стола. Входы — сырые строки БД одного стола.
export function buildSession(session, ctx) {
  const {
    orders = [], itemsByOrder = new Map(), modsByItem = new Map(), dishNames = new Map(), modifierNames = new Map(),
    calls = [], events = [], reviews = [], waiters = new Map(), assignedWaiterId = null, now = new Date(),
  } = ctx
  const end = session.ended_at || (session.is_active ? now.toISOString() : session.started_at)

  const items = []
  let total = 0
  for (const o of orders) {
    const its = itemsByOrder.get(o.id) || []
    total += orderItemsTotal(its, modsByItem)
    for (const it of its) {
      const mods = (modsByItem.get(it.id) || []).map((m) => modifierNames.get(m.modifier_id)).filter(Boolean)
      items.push({
        name: dishNames.get(it.item_id) || 'Блюдо удалено из меню',
        seat: it.seat_number ?? null,
        quantity: it.quantity,
        price: Number(it.unit_price || 0) + (modsByItem.get(it.id) || []).reduce((s, m) => s + Number(m.price_delta || 0), 0),
        modifiers: mods,
        comment: it.comment || null,
        status: it.status || null,
      })
    }
  }
  items.sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99))

  const seats = new Set(items.map((i) => i.seat).filter((s) => s != null))
  // Через сколько после посадки ушёл на кухню первый заказ.
  const firstSent = orders.flatMap((o) => (itemsByOrder.get(o.id) || []).map((it) => it.sent_at)).filter(Boolean)
    .map((t) => new Date(t).getTime()).sort((a, b) => a - b)[0]
  const firstOrderMin = firstSent ? Math.max(0, Math.round((firstSent - new Date(session.started_at).getTime()) / 60000)) : null
  const waiter = resolveSessionWaiter(session, {
    eventWaiterIds: events.map((e) => e.waiter_id),
    assignedWaiterId,
  })

  const sessionCalls = calls.map((c) => ({
    at: c.created_at,
    reason: c.reason || null,
    kind: c.kind || null,
    reactionSec: c.acknowledged_at ? Math.max(0, Math.round((new Date(c.acknowledged_at) - new Date(c.created_at)) / 1000)) : null,
    acknowledgedBy: waiterName(waiters.get(c.acknowledged_by)) || null,
  }))

  const review = reviews[0]
    ? { food: reviews[0].rating_food ?? null, service: reviews[0].rating_service ?? null, comment: reviews[0].comment || null }
    : null

  return {
    id: session.id,
    startedAt: session.started_at,
    endedAt: session.ended_at || null,
    active: !!session.is_active,
    status: session.status || null,
    billType: session.bill_type || null,
    durationMin: minutesBetween(session.started_at, end),
    guestCount: session.guest_count || seats.size || null,
    firstOrderMin,
    waiter: { id: waiter.id, name: waiterName(waiters.get(waiter.id)), inferred: waiter.inferred },
    total,
    items,
    calls: sessionCalls,
    upsell: {
      offered: events.length,
      accepted: events.filter((e) => e.outcome === 'accepted').length,
    },
    review,
  }
}

// Раскладка «что к какой посадке»: заказы — по table_session_id, а без него
// (старые) — по столу и времени; вызовы и отзывы — по столу и времени.
export function inWindow(at, session, { beforeMin = 2, afterMin = 0, now = new Date() } = {}) {
  const t = new Date(at).getTime()
  const from = new Date(session.started_at).getTime() - beforeMin * 60000
  const end = session.ended_at ? new Date(session.ended_at).getTime() : (session.is_active ? now.getTime() : from)
  return t >= from && t <= end + afterMin * 60000
}

export function ordersOfSession(session, orders, opts) {
  return (orders || []).filter((o) => o.table_session_id
    ? o.table_session_id === session.id
    : o.table_id === session.table_id && inWindow(o.created_at, session, opts))
}

// Сводка дня по уже собранным посадкам.
export function daySummary(sessions, tableCount) {
  const done = sessions.filter((s) => s.total > 0)
  const revenue = done.reduce((s, x) => s + x.total, 0)
  const guests = sessions.reduce((s, x) => s + (x.guestCount || 0), 0)
  const durations = sessions.filter((s) => !s.active && s.durationMin > 0).map((s) => s.durationMin)
  return {
    sessions: sessions.length,
    guests,
    revenue,
    avgCheck: done.length ? Math.round(revenue / done.length) : 0,
    avgGuestCheck: guests ? Math.round(revenue / guests) : 0,
    turnsPerTable: tableCount ? Math.round((sessions.length / tableCount) * 10) / 10 : 0,
    avgDurationMin: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
  }
}

// Проверка брони: пересечение по времени с другой активной бронью того же стола.
export function reservationConflict(candidate, existing) {
  const s = new Date(candidate.starts_at).getTime()
  const e = new Date(candidate.ends_at).getTime()
  return (existing || []).find((r) => r.id !== candidate.id
    && r.table_id === candidate.table_id
    && (r.status === 'confirmed' || r.status === 'seated')
    && new Date(r.starts_at).getTime() < e
    && new Date(r.ends_at).getTime() > s) || null
}

// Раскладка столов: проценты в пределах зала, форма из допустимых.
const SHAPES = new Set(['round', 'square', 'rect'])
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export function sanitizeLayout(l) {
  const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
  const w = num(l.w), h = num(l.h)
  return {
    layout_x: num(l.x) === null ? null : clamp(num(l.x), 0, 100),
    layout_y: num(l.y) === null ? null : clamp(num(l.y), 0, 100),
    layout_w: w === null ? null : clamp(w, 2, 60),
    layout_h: h === null ? null : clamp(h, 2, 60),
    layout_shape: SHAPES.has(l.shape) ? l.shape : null,
    layout_rotation: Math.round(clamp(num(l.rotation) || 0, -180, 180)),
  }
}
