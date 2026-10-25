// Раздел «Статистика» в админке — чтение из БД (под service_role).
// Посадки за период и за такой же период до него — как в «Официантах»
// (staffService.loadPeriod), дальше — чистые расчёты statsCore.

import { addDays } from './hallCore.js'
import { aggregate, byDay } from './staffCore.js'
import { loadPeriod } from './staffService.js'
import { compare, byHour, byWeekday, dishStats, tableStats, aiStats, guestAppStats } from './statsCore.js'

export async function getStats(restaurantId, fromStr, toStr) {
  const data = await loadPeriod(restaurantId, fromStr, toStr)
  const { period, restaurant } = data
  const days = period.days.length
  // Прошлый период той же длины — сразу перед выбранным.
  const prevPeriod = { from: addDays(period.from, -days), to: addDays(period.from, -1) }
  const prev = await loadPeriod(restaurantId, prevPeriod.from, prevPeriod.to)

  const totals = aggregate(data.sessions)
  const prevTotals = aggregate(prev.sessions)
  // Сегодняшний день ещё идёт — сравнение с полным прошлым днём занижено.
  const partial = period.to >= data.today

  return {
    restaurant,
    today: data.today,
    period: { from: period.from, to: period.to, days },
    previous: { ...prevPeriod, hasData: prev.sessions.length > 0 },
    partial,
    kpi: compare(totals, prevTotals),
    totals,
    byDay: byDay(data.sessions, data.events, period.days),
    byHour: byHour(data.sessions, restaurant.timezone, days),
    byWeekday: days >= 7 ? byWeekday(data.sessions, period.days) : null,
    dishes: dishStats(data.sessions, data.dishes),
    tables: tableStats(data.sessions, data.tables, days),
    ai: aiStats(data.events, data.guestEvents, data.dishes, totals.revenue, data.cartEvents),
    guestApp: guestAppStats(data.sessions),
  }
}
