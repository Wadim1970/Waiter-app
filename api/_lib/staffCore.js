// Раздел «Официанты» в админке — ЧИСТАЯ логика: период, итоги по посадкам,
// доп. продажи по ИИ-событиям, разбивка по дням и столам.
// Посадки собирает hallCore.buildSession; ввод/вывод — staffService.js.

import { addDays, isDateStr } from './hallCore.js'

export const MAX_PERIOD_DAYS = 92

export const TECHNIQUE_LABELS = {
  taste_pairing: 'Сочетание вкусов',
  choice_no_choice: 'Выбор без выбора',
  social_proof: 'Социальное доказательство',
  scarcity: 'Ограниченное предложение',
}

export const CATEGORY_LABELS = {
  main: 'Основные блюда',
  dessert: 'Десерты',
  soft: 'Напитки',
  alco: 'Алкоголь',
}

// Период включительно: «с» ≤ «по», не длиннее MAX_PERIOD_DAYS.
export function normalizePeriod(from, to, today) {
  const f = isDateStr(from) ? from : today
  let t = isDateStr(to) ? to : f
  if (t < f) t = f
  const days = periodDates(f, t)
  if (days.length > MAX_PERIOD_DAYS) {
    const e = new Error(`Период не длиннее ${MAX_PERIOD_DAYS} дней`)
    e.status = 400
    throw e
  }
  return { from: f, to: t, days }
}

export function periodDates(from, to) {
  const out = []
  for (let d = from; d <= to && out.length <= MAX_PERIOD_DAYS; d = addDays(d, 1)) out.push(d)
  return out
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10)

// Итоги по набору посадок (одного официанта или всего ресторана).
export function aggregate(sessions) {
  const paid = sessions.filter((s) => s.total > 0)
  const revenue = paid.reduce((s, x) => s + x.total, 0)
  const guests = sessions.reduce((s, x) => s + (x.guestCount || 0), 0)
  const calls = sessions.flatMap((s) => s.calls || [])
  const answered = calls.filter((c) => c.reactionSec != null)
  const durations = sessions.filter((s) => !s.active && s.durationMin > 0).map((s) => s.durationMin)
  const firstOrder = sessions.map((s) => s.firstOrderMin).filter((m) => m != null && m <= 180)
  const ratings = sessions.map((s) => s.review?.service).filter((r) => r != null)
  return {
    sessions: sessions.length,
    guests,
    revenue,
    avgCheck: paid.length ? Math.round(revenue / paid.length) : 0,
    avgGuestCheck: guests ? Math.round(revenue / guests) : 0,
    avgDurationMin: durations.length ? Math.round(avg(durations)) : null,
    calls: calls.length,
    unansweredCalls: calls.length - answered.length,
    avgReactionSec: answered.length ? Math.round(avg(answered.map((c) => c.reactionSec))) : null,
    avgFirstOrderMin: firstOrder.length ? Math.round(avg(firstOrder)) : null,
    serviceRating: round1(avg(ratings)),
    reviews: ratings.length,
  }
}

// Доп. продажи по подсказкам ИИ: предложено (официант показал/перебрал
// подсказку) и продано («В корзину» — блюдо ушло в заказ).
export function upsellStats(events, dishes = new Map()) {
  const offered = events.length
  const accepted = events.filter((e) => e.outcome === 'accepted')
  const revenue = accepted.reduce((s, e) => s + Number(dishes.get(e.dish_id)?.price || 0), 0)

  const group = (keyOf, labels) => {
    const m = new Map()
    for (const e of events) {
      const k = keyOf(e) || 'other'
      const g = m.get(k) || { key: k, label: labels[k] || 'Другое', offered: 0, accepted: 0 }
      g.offered++
      if (e.outcome === 'accepted') g.accepted++
      m.set(k, g)
    }
    return [...m.values()].map((g) => ({ ...g, rate: g.offered ? Math.round((g.accepted / g.offered) * 100) : 0 }))
      .sort((a, b) => b.offered - a.offered)
  }

  const top = new Map()
  for (const e of accepted) {
    const d = dishes.get(e.dish_id)
    const name = d?.name || 'Блюдо удалено из меню'
    const t = top.get(name) || { name, accepted: 0, revenue: 0 }
    t.accepted++
    t.revenue += Number(d?.price || 0)
    top.set(name, t)
  }

  return {
    offered,
    accepted: accepted.length,
    rate: offered ? Math.round((accepted.length / offered) * 100) : 0,
    revenue,
    byTechnique: group((e) => e.technique, TECHNIQUE_LABELS),
    byCategory: group((e) => e.category, CATEGORY_LABELS),
    topDishes: [...top.values()].sort((a, b) => b.accepted - a.accepted || b.revenue - a.revenue).slice(0, 10),
  }
}

// По дням периода — для графиков динамики.
export function byDay(sessions, events, dates) {
  const s = new Map(dates.map((d) => [d, []]))
  for (const x of sessions) s.get(x.date)?.push(x)
  const e = new Map(dates.map((d) => [d, { offered: 0, accepted: 0 }]))
  for (const x of events) {
    const g = e.get(x.date)
    if (!g) continue
    g.offered++
    if (x.outcome === 'accepted') g.accepted++
  }
  return dates.map((date) => {
    const a = aggregate(s.get(date))
    return { date, sessions: a.sessions, guests: a.guests, revenue: a.revenue, avgCheck: a.avgCheck, ...e.get(date) }
  })
}

// Какие столы обслуживал и как часто их занимали.
export function tablesSummary(sessions) {
  const m = new Map()
  for (const s of sessions) {
    const t = m.get(s.tableId) || { tableId: s.tableId, number: s.tableNumber, sessions: 0, guests: 0, revenue: 0 }
    t.sessions++
    t.guests += s.guestCount || 0
    t.revenue += s.total
    m.set(s.tableId, t)
  }
  return [...m.values()].sort((a, b) => a.number - b.number)
}

// Рабочие дни: отмеченные смены и дни, когда у официанта были посадки.
export function workDays(shiftDates, sessionDates) {
  return new Set([...shiftDates, ...sessionDates]).size
}
