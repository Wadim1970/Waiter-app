// Раздел «Статистика» в админке — ЧИСТАЯ логика: сравнение с прошлым
// периодом, загрузка по часам и дням недели, блюда и разделы меню, столы,
// эффект ИИ-подсказок. Посадки собирает staffService.loadPeriod.

import { DAY_START_HOUR, tzOffsetMinutes } from './hallCore.js'
import { upsellStats } from './staffCore.js'

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
const round1 = (x) => Math.round(x * 10) / 10

// Изменение к прошлому периоду, %: null — сравнивать не с чем.
export function delta(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null
  return Math.round(((cur - prev) / prev) * 100)
}

export const KPI_KEYS = ['revenue', 'sessions', 'guests', 'avgCheck', 'avgGuestCheck', 'avgDurationMin']

export function compare(cur, prev) {
  return Object.fromEntries(KPI_KEYS.map((k) => [k, { value: cur[k], prev: prev[k], delta: delta(cur[k], prev[k]) }]))
}

// Местный час и день недели (1 — пн … 7 — вс) момента. Ночь до 06:00
// относится к дню ресторана, начавшемуся накануне, — и по дню недели тоже.
export function localHour(iso, tz) {
  const t = new Date(iso)
  const local = new Date(t.getTime() + tzOffsetMinutes(tz, t) * 60000)
  return local.getUTCHours()
}

export function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  return d === 0 ? 7 : d
}

// Загрузка по часам открытия посадки: всего и в среднем за день периода.
// Часы — в порядке дня ресторана: 06, 07 … 23, 00 … 05.
export function byHour(sessions, tz, days) {
  const hours = Array.from({ length: 24 }, (_, i) => (DAY_START_HOUR + i) % 24)
  const m = new Map(hours.map((h) => [h, { hour: h, sessions: 0, guests: 0, revenue: 0 }]))
  for (const s of sessions) {
    const g = m.get(localHour(s.startedAt, tz))
    g.sessions++
    g.guests += s.guestCount || 0
    g.revenue += s.total
  }
  const n = Math.max(1, days)
  return hours.map((h) => {
    const g = m.get(h)
    return { ...g, avgSessions: round1(g.sessions / n), avgRevenue: Math.round(g.revenue / n) }
  })
}

// По дням недели — в среднем на один такой день периода (в периоде их
// может быть разное число: две пятницы и одна суббота).
export function byWeekday(sessions, dates) {
  const count = new Map()
  for (const d of dates) count.set(weekdayOf(d), (count.get(weekdayOf(d)) || 0) + 1)
  const m = new Map([1, 2, 3, 4, 5, 6, 7].map((w) => [w, { weekday: w, days: count.get(w) || 0, sessions: 0, guests: 0, revenue: 0 }]))
  for (const s of sessions) {
    const g = m.get(weekdayOf(s.date))
    g.sessions++
    g.guests += s.guestCount || 0
    g.revenue += s.total
  }
  return [...m.values()].map((g) => ({
    ...g,
    avgSessions: g.days ? round1(g.sessions / g.days) : 0,
    avgRevenue: g.days ? Math.round(g.revenue / g.days) : 0,
  }))
}

// Витринные разделы («Популярное», «Хиты»…) дублируют блюда из основных —
// раздел блюда берём основной, если он есть.
const SHOWCASE_RE = /популяр|хит|рекоменд|новинк|топ|лучш/i
function mainSections(dishes) {
  const m = new Map()
  for (const d of dishes.values()) {
    const key = (d.name || '').trim().toLowerCase()
    if (!key || !d.section) continue
    const cur = m.get(key)
    if (!cur || (SHOWCASE_RE.test(cur) && !SHOWCASE_RE.test(d.section))) m.set(key, d.section)
  }
  return m
}

// Продажи блюд: сколько штук и на какую сумму, доля выручки; разделы меню;
// блюда меню, которые за период ни разу не заказали.
export function dishStats(sessions, dishes, { top = 20 } = {}) {
  const m = new Map()
  const sectionOf = mainSections(dishes)
  let total = 0
  for (const s of sessions) {
    for (const it of s.items || []) {
      const q = Number(it.quantity || 1)
      const sum = q * Number(it.price || 0)
      total += sum
      const d = dishes.get(it.dishId)
      const name = d?.name || 'Блюдо удалено из меню'
      // Одно блюдо бывает заведено несколькими строками меню — считаем по названию.
      const key = name.trim().toLowerCase()
      const g = m.get(key) || { name, section: sectionOf.get(key) || d?.section || null, quantity: 0, revenue: 0, sessions: new Set() }
      g.quantity += q
      g.revenue += sum
      g.sessions.add(s.id)
      m.set(key, g)
    }
  }
  const all = [...m.values()].map(({ sessions: ss, ...g }) => ({ ...g, orders: ss.size, share: pct(g.revenue, total) }))
    .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity)

  const sec = new Map()
  for (const d of all) {
    const k = d.section || 'Без раздела'
    const g = sec.get(k) || { section: k, quantity: 0, revenue: 0, dishes: 0 }
    g.quantity += d.quantity
    g.revenue += d.revenue
    g.dishes++
    sec.set(k, g)
  }
  const sections = [...sec.values()].map((g) => ({ ...g, share: pct(g.revenue, total) }))
    .sort((a, b) => b.revenue - a.revenue)

  // Блюдо, проданное из любого раздела, — продавалось.
  const sold = new Set(all.map((d) => (d.name || '').trim().toLowerCase()))
  const unsoldNames = new Map()
  for (const d of dishes.values()) {
    if (d.hidden) continue
    const key = (d.name || '').trim().toLowerCase()
    if (!key || sold.has(key) || unsoldNames.has(key)) continue
    unsoldNames.set(key, { name: d.name, section: sectionOf.get(key) || d.section || null, price: d.price })
  }
  const unsold = [...unsoldNames.values()].sort((a, b) => (a.section || '').localeCompare(b.section || '', 'ru') || a.name.localeCompare(b.name, 'ru'))

  return { total, top: all.slice(0, top), bottom: all.length > top ? all.slice(-10).reverse() : [], dishesSold: all.length, sections, unsold }
}

// Столы: посадки, гости, выручка, сколько часов занят, заполнение мест.
export function tableStats(sessions, tables, days) {
  const m = new Map(tables.map((t) => [t.id, { tableId: t.id, number: t.number, zone: t.zone || 'main', capacity: t.capacity || null, active: t.is_active !== false, sessions: 0, guests: 0, revenue: 0, minutes: 0 }]))
  for (const s of sessions) {
    const g = m.get(s.tableId)
    if (!g) continue
    g.sessions++
    g.guests += s.guestCount || 0
    g.revenue += s.total
    g.minutes += s.durationMin || 0
  }
  const n = Math.max(1, days)
  return [...m.values()]
    .filter((t) => t.active || t.sessions)
    .map(({ minutes, ...t }) => ({
      ...t,
      hoursPerDay: round1(minutes / 60 / n),
      sessionsPerDay: round1(t.sessions / n),
      avgCheck: t.sessions ? Math.round(t.revenue / t.sessions) : 0,
      // Сколько мест в среднем занято за посадку: 2 гостя за столом на 6 — 33 %.
      seatFill: t.capacity && t.sessions ? pct(t.guests / t.sessions, t.capacity) : null,
    }))
    .sort((a, b) => Number(a.number) - Number(b.number))
}

// Эффект ИИ: подсказки официанту и гостю в меню — предложено, принято,
// на какую сумму, какая доля выручки.
export function aiStats(waiterEvents, guestEvents, dishes, revenue) {
  const w = upsellStats(waiterEvents, dishes)
  const g = upsellStats(guestEvents, dishes)
  const aiRevenue = w.revenue + g.revenue
  return {
    waiter: { offered: w.offered, accepted: w.accepted, rate: w.rate, revenue: w.revenue, byTechnique: w.byTechnique, byCategory: w.byCategory, topDishes: w.topDishes },
    guestMenu: { offered: g.offered, accepted: g.accepted, rate: g.rate, revenue: g.revenue, topDishes: g.topDishes },
    revenue: aiRevenue,
    share: pct(aiRevenue, revenue),
  }
}

// Гостевое приложение: вызовы официанта с телефона и как быстро подходили,
// отзывы, посадки с участием гостевого меню.
export function guestAppStats(sessions) {
  const reviewsCount = sessions.filter((s) => s.review).length
  const calls = sessions.flatMap((s) => s.calls || []).filter((c) => c.kind !== 'dessert')
  const answered = calls.filter((c) => c.reactionSec != null)
  const withCalls = sessions.filter((s) => (s.calls || []).some((c) => c.kind !== 'dessert')).length
  return {
    calls: calls.length,
    answered: answered.length,
    avgReactionSec: answered.length ? Math.round(answered.reduce((a, c) => a + c.reactionSec, 0) / answered.length) : null,
    slowCalls: answered.filter((c) => c.reactionSec > 180).length,
    sessionsWithCalls: withCalls,
    sessionsWithCallsPct: pct(withCalls, sessions.length),
    reviews: reviewsCount,
    reviewsPct: pct(reviewsCount, sessions.length),
  }
}

