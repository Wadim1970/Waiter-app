// Раздел «Брони» в админке — ЧИСТАЯ логика: телефон гостя, история его
// визитов и броней в ЭТОМ ресторане, отметки на брони, демо-лояльность.
// Ввод/вывод — bookingsService.js.

import { addDays } from './hallCore.js'

// Брони смотрим и заводим на 30 дней вперёд, не дальше.
export const BOOKING_DAYS_AHEAD = 30

// Телефон → +7XXXXXXXXXX (как его хранит личный кабинет гостя после SMS).
// Не российский номер — «+» и цифры; мусор — null.
export function normalizePhone(raw) {
  const d = String(raw || '').replace(/\D/g, '')
  if (d.length === 10 && d[0] === '9') return `+7${d}`
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return `+7${d.slice(1)}`
  if (d.length >= 10 && d.length <= 15) return `+${d}`
  return null
}

// Как этот номер мог быть записан в guests.phone.
export function phoneVariants(phone) {
  if (!phone) return []
  const d = phone.slice(1)
  return phone.startsWith('+7') ? [phone, d, `8${d.slice(1)}`] : [phone, d]
}

const DAY_MS = 86400_000

// День рождения в пределах ±days от даты брони (через Новый год тоже).
export function birthdayNear(day, month, dateStr, days = 7) {
  if (!day || !month) return null
  const base = new Date(`${dateStr}T00:00:00Z`)
  for (const y of [base.getUTCFullYear() - 1, base.getUTCFullYear(), base.getUTCFullYear() + 1]) {
    const b = new Date(Date.UTC(y, month - 1, day))
    if (b.getUTCMonth() !== month - 1) continue // 29 февраля в невисокосный год
    const diff = Math.round((b - base) / DAY_MS)
    if (Math.abs(diff) <= days) return diff
  }
  return null
}

// Демо программы лояльности: уровень по числу визитов, кешбэк баллами.
// Настоящую программу ресторан подключит позже — тогда здесь будут его правила.
export const LOYALTY_LEVELS = [
  { key: 'bronze', name: 'Бронза', from: 1, cashbackPct: 3 },
  { key: 'silver', name: 'Серебро', from: 3, cashbackPct: 5 },
  { key: 'gold', name: 'Золото', from: 6, cashbackPct: 7 },
  { key: 'platinum', name: 'Платина', from: 12, cashbackPct: 10 },
]

export function loyaltyDemo({ visits, spent, appRegistered }) {
  if (!appRegistered && visits === 0) return null
  const level = [...LOYALTY_LEVELS].reverse().find((l) => visits >= l.from) || null
  const next = LOYALTY_LEVELS.find((l) => visits < l.from) || null
  return {
    demo: true,
    member: appRegistered,
    level: level && { key: level.key, name: level.name, cashbackPct: level.cashbackPct },
    next: next && { name: next.name, visitsLeft: next.from - visits },
    // Сколько баллов накопил бы гость кешбэком своего уровня.
    balance: level ? Math.round((spent * level.cashbackPct) / 100) : 0,
  }
}

// История гостя в ресторане по его посадкам (seat-уровень: только то, что
// заказал он сам) и броням с его номером.
export function guestHistory({ visits = [], reservations = [], now = new Date() }) {
  const done = visits.filter((v) => v.spent > 0 || v.items.length)
  const spent = done.reduce((s, v) => s + v.spent, 0)
  const dishes = new Map()
  for (const v of done) {
    for (const it of v.items) {
      const key = (it.name || '').trim().toLowerCase()
      if (!key) continue
      const d = dishes.get(key) || { name: it.name, times: 0, visits: new Set() }
      d.times += it.quantity || 1
      d.visits.add(v.id)
      dishes.set(key, d)
    }
  }
  const count = (rows, key) => {
    const m = new Map()
    for (const r of rows) if (r[key] != null) m.set(r[key], (m.get(r[key]) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }
  const parties = done.map((v) => v.guestCount).filter((n) => n > 0)
  const past = reservations.filter((r) => new Date(r.startsAt) < now)
  const sorted = [...done].sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
  return {
    visits: done.length,
    firstVisit: sorted[0]?.startedAt || null,
    lastVisit: sorted[sorted.length - 1]?.startedAt || null,
    spent,
    avgCheck: done.length ? Math.round(spent / done.length) : 0,
    avgParty: parties.length ? Math.round((parties.reduce((a, b) => a + b, 0) / parties.length) * 10) / 10 : null,
    topDishes: [...dishes.values()]
      .map((d) => ({ name: d.name, times: d.times, visits: d.visits.size }))
      .sort((a, b) => b.visits - a.visits || b.times - a.times)
      .slice(0, 8),
    favoriteTables: count(done, 'tableNumber').slice(0, 3).map(([number, times]) => ({ number, times })),
    waiters: count(done, 'waiterId').slice(0, 3).map(([id, times]) => ({ id, times })),
    reservations: {
      total: reservations.length,
      came: past.filter((r) => r.status === 'seated').length,
      noShow: past.filter((r) => r.status === 'no_show').length,
      cancelled: reservations.filter((r) => r.status === 'cancelled').length,
    },
  }
}

// Отметки на брони для схемы и списка — коротко, без всей истории.
export function guestBadges(card, dateStr) {
  if (!card) return { known: false, app: false, regular: false, loyalty: null, birthdayIn: null, noShows: 0, visits: 0 }
  const h = card.history
  return {
    known: h.visits > 0 || h.reservations.came > 0,
    app: !!card.app,
    regular: h.visits >= 3,
    loyalty: card.loyalty?.level?.name || null,
    birthdayIn: card.app ? birthdayNear(card.app.birthdayDay, card.app.birthdayMonth, dateStr) : null,
    noShows: h.reservations.noShow,
    visits: h.visits,
    name: card.name,
  }
}

// Дни календаря: сегодня … +30.
export function bookingDates(today) {
  return Array.from({ length: BOOKING_DAYS_AHEAD + 1 }, (_, i) => addDays(today, i))
}
