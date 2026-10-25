// node --test api/_lib/statsService.test.js — раздел «Статистика» на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { delta, localHour, weekdayOf, byHour, byWeekday, dishStats, tableStats, guestAppStats } from './statsCore.js'

const hall = await import('./hallService.js')
const svc = await import('./statsService.js')

const R = '11111111-1111-1111-1111-111111111111'
const T1 = 'a0000000-0000-0000-0000-000000000001'
const T2 = 'a0000000-0000-0000-0000-000000000002'
const ANNA = 'b0000000-0000-0000-0000-000000000001'
const NOW = new Date('2026-10-23T17:00:00Z') // 23.10, 20:00 МСК

function seed() {
  return fakeDb({
    restaurants: [{ restaurantId: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    tables: [
      { id: T1, restaurant_id: R, number: 1, zone: 'main', capacity: 4, is_active: true },
      { id: T2, restaurant_id: R, number: 2, zone: 'veranda', capacity: 2, is_active: true },
    ],
    waiters: [{ id: ANNA, restaurant_id: R, first_name: 'Анна', last_name: 'Петрова' }],
    waiter_table_assignments: [],
    staff_shifts: [],
    table_sessions: [
      // 22.10 и 23.10 — выбранный период; 20.10 и 21.10 — прошлый.
      { id: 's1', table_id: T1, waiter_id: ANNA, guest_count: 2, started_at: '2026-10-22T09:00:00Z', ended_at: '2026-10-22T10:00:00Z', is_active: false },
      { id: 's2', table_id: T1, waiter_id: ANNA, guest_count: 4, started_at: '2026-10-23T16:00:00Z', ended_at: '2026-10-23T18:00:00Z', is_active: false },
      { id: 's3', table_id: T2, waiter_id: null, guest_count: 1, started_at: '2026-10-22T21:30:00Z', ended_at: '2026-10-22T22:00:00Z', is_active: false }, // 00:30 МСК 23.10 — ночь 22.10
      { id: 'p1', table_id: T1, waiter_id: ANNA, guest_count: 2, started_at: '2026-10-21T09:00:00Z', ended_at: '2026-10-21T10:00:00Z', is_active: false },
    ],
    orders: [
      { id: 'o1', table_id: T1, table_session_id: 's1', status: 'paid', created_at: '2026-10-22T09:05:00Z' },
      { id: 'o2', table_id: T1, table_session_id: 's2', status: 'paid', created_at: '2026-10-23T16:05:00Z' },
      { id: 'o3', table_id: T2, table_session_id: 's3', status: 'paid', created_at: '2026-10-22T21:35:00Z' },
      { id: 'op', table_id: T1, table_session_id: 'p1', status: 'paid', created_at: '2026-10-21T09:05:00Z' },
    ],
    order_items: [
      { id: 'i1', order_id: 'o1', item_id: 'd1', quantity: 2, unit_price: 1000 },
      { id: 'i2', order_id: 'o2', item_id: 'd2', quantity: 2, unit_price: 1500 },
      { id: 'i3', order_id: 'o2', item_id: 'pop-d1', quantity: 1, unit_price: 1000 }, // борщ из «Популярного»
      { id: 'i4', order_id: 'o3', item_id: 'd3', quantity: 1, unit_price: 500 },
      { id: 'ip', order_id: 'op', item_id: 'd1', quantity: 2, unit_price: 1000 },
    ],
    order_item_modifiers: [],
    menu_items: [
      { id: 'd1', restaurant_id: R, dish_name: 'Борщ', cost_rub: 1000, menu_section: 'Супы' },
      { id: 'pop-d1', restaurant_id: R, dish_name: 'Борщ', cost_rub: 1000, menu_section: 'Популярное' },
      { id: 'd2', restaurant_id: R, dish_name: 'Стейк', cost_rub: 1500, menu_section: 'Горячее' },
      { id: 'd3', restaurant_id: R, dish_name: 'Морс', cost_rub: 500, menu_section: 'Напитки' },
      { id: 'd4', restaurant_id: R, dish_name: 'Тирамису', cost_rub: 600, menu_section: 'Десерты' },
      { id: 'd5', restaurant_id: R, dish_name: 'Секретное', cost_rub: 600, menu_section: 'Десерты', is_hidden: true },
    ],
    modifiers: [],
    waiter_calls: [
      { id: 'c1', table_id: T1, status: 'acknowledged', created_at: '2026-10-22T09:30:00Z', acknowledged_at: '2026-10-22T09:31:00Z', acknowledged_by: ANNA },
      { id: 'c2', table_id: T1, status: 'acknowledged', created_at: '2026-10-23T17:00:00Z', acknowledged_at: '2026-10-23T17:05:00Z', acknowledged_by: ANNA },
    ],
    ai_suggestion_events: [
      { restaurant_id: R, order_id: 'o1', waiter_id: ANNA, dish_id: 'd3', category: 'soft', technique: 'taste_pairing', outcome: 'accepted', created_at: '2026-10-22T09:20:00Z', channel: 'waiter' },
      { restaurant_id: R, order_id: 'o2', waiter_id: ANNA, dish_id: 'd4', category: 'dessert', technique: 'taste_pairing', outcome: 'rejected', created_at: '2026-10-23T16:20:00Z', channel: 'waiter' },
      { restaurant_id: R, waiter_id: null, dish_id: 'd2', technique: 'taste_pairing', outcome: 'accepted', created_at: '2026-10-23T16:10:00Z', channel: 'guest_menu' },
      { restaurant_id: R, waiter_id: null, dish_id: 'd4', technique: 'taste_pairing', outcome: 'ignored', created_at: '2026-10-23T16:11:00Z', channel: 'guest_menu' },
    ],
    reviews: [{ restaurant_id: R, table_number: '1', rating_food: 5, rating_service: 5, created_at: '2026-10-22T09:50:00Z' }],
    reviews_waiter: [],
    table_reservations: [],
  })
}

beforeEach(() => {
  hall.deps.db = seed()
  hall.deps.now = () => NOW
})

test('изменение к прошлому периоду', () => {
  assert.equal(delta(150, 100), 50)
  assert.equal(delta(50, 100), -50)
  assert.equal(delta(10, 0), null)
  assert.equal(delta(null, 5), null)
})

test('местный час и день недели', () => {
  assert.equal(localHour('2026-10-22T21:30:00Z', 'Europe/Moscow'), 0)
  assert.equal(localHour('2026-10-22T09:00:00Z', 'Asia/Almaty'), 14)
  assert.equal(weekdayOf('2026-10-25'), 7) // воскресенье
  assert.equal(weekdayOf('2026-10-26'), 1)
})

test('по часам: порядок дня ресторана и среднее за день', () => {
  const h = byHour([{ startedAt: '2026-10-22T09:00:00Z', guestCount: 2, total: 1000 }, { startedAt: '2026-10-22T21:30:00Z', guestCount: 1, total: 500 }], 'Europe/Moscow', 2)
  assert.equal(h[0].hour, 6)
  assert.equal(h[23].hour, 5)
  const noon = h.find((x) => x.hour === 12)
  assert.deepEqual([noon.sessions, noon.revenue, noon.avgSessions, noon.avgRevenue], [1, 1000, 0.5, 500])
  assert.equal(h.find((x) => x.hour === 0).sessions, 1)
})

test('по дням недели — среднее на такой день', () => {
  const dates = ['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']
  const w = byWeekday([{ date: '2026-10-16', total: 1000, guestCount: 2 }, { date: '2026-10-23', total: 3000, guestCount: 2 }, { date: '2026-10-17', total: 700 }], dates)
  const fri = w.find((x) => x.weekday === 5)
  assert.deepEqual([fri.days, fri.sessions, fri.avgRevenue, fri.avgSessions], [2, 2, 2000, 1])
  assert.equal(w.find((x) => x.weekday === 6).avgRevenue, 700)
})

test('блюда: одно блюдо из разных разделов меню — одной строкой, скрытые не в «не продавались»', () => {
  const dishes = new Map([
    ['d1', { name: 'Борщ', price: 1000, section: 'Супы' }],
    ['pop', { name: 'Борщ', price: 1000, section: 'Популярное' }],
    ['d2', { name: 'Стейк', price: 1500, section: 'Горячее' }],
    ['d4', { name: 'Тирамису', price: 600, section: 'Десерты' }],
    ['d5', { name: 'Секретное', price: 600, section: 'Десерты', hidden: true }],
  ])
  const r = dishStats([
    { id: 's2', items: [{ dishId: 'pop', quantity: 1, price: 1000 }, { dishId: 'd2', quantity: 1, price: 1500 }] },
    { id: 's1', items: [{ dishId: 'd1', quantity: 2, price: 1000 }] },
  ], dishes)
  assert.equal(r.total, 4500)
  assert.deepEqual(r.top.map((d) => [d.name, d.section, d.quantity, d.revenue, d.orders, d.share]), [['Борщ', 'Супы', 3, 3000, 2, 67], ['Стейк', 'Горячее', 1, 1500, 1, 33]])
  assert.deepEqual(r.sections.map((s) => [s.section, s.revenue]), [['Супы', 3000], ['Горячее', 1500]])
  assert.deepEqual(r.unsold.map((d) => d.name), ['Тирамису'])
})

test('столы: часы в день и заполнение мест', () => {
  const t = tableStats(
    [{ tableId: 'a', total: 2000, guestCount: 2, durationMin: 90 }, { tableId: 'a', total: 1000, guestCount: 4, durationMin: 30 }],
    [{ id: 'a', number: 1, capacity: 6 }, { id: 'b', number: 2, capacity: 2 }, { id: 'c', number: 3, is_active: false }],
    2,
  )
  assert.deepEqual(t.map((x) => x.number), [1, 2])
  assert.deepEqual([t[0].hoursPerDay, t[0].sessionsPerDay, t[0].avgCheck, t[0].seatFill], [1, 1, 1500, 50])
  assert.equal(t[1].seatFill, null)
})

test('гостевое приложение: вызовы и отзывы', () => {
  const g = guestAppStats([{ calls: [{ reactionSec: 60 }, { reactionSec: 300 }, { reactionSec: null }], review: { food: 5 } }, { calls: [] }])
  assert.deepEqual([g.calls, g.answered, g.avgReactionSec, g.slowCalls, g.sessionsWithCallsPct, g.reviews, g.reviewsPct], [3, 2, 180, 1, 50, 1, 50])
})

test('статистика за период со сравнением', async () => {
  const s = await svc.getStats(R, '2026-10-22', '2026-10-23')
  assert.deepEqual(s.period, { from: '2026-10-22', to: '2026-10-23', days: 2 })
  assert.deepEqual([s.previous.from, s.previous.to, s.previous.hasData], ['2026-10-20', '2026-10-21', true])
  assert.equal(s.partial, true)
  assert.equal(s.kpi.revenue.value, 2000 + 4000 + 500)
  assert.equal(s.kpi.revenue.prev, 2000)
  assert.equal(s.kpi.revenue.delta, 225)
  assert.equal(s.kpi.sessions.value, 3)
  // Ночная посадка 00:30 23.10 — в дне 22.10.
  assert.deepEqual(s.byDay.map((d) => [d.date, d.sessions, d.revenue]), [['2026-10-22', 2, 2500], ['2026-10-23', 1, 4000]])
  assert.equal(s.byHour.find((h) => h.hour === 0).sessions, 1)
  assert.equal(s.byWeekday, null)
  assert.deepEqual(s.dishes.top.map((d) => [d.name, d.quantity]), [['Борщ', 3], ['Стейк', 2], ['Морс', 1]])
  assert.deepEqual(s.dishes.unsold.map((d) => d.name), ['Тирамису'])
  assert.deepEqual(s.tables.map((t) => [t.number, t.sessions, t.revenue]), [[1, 2, 6000], [2, 1, 500]])
  assert.deepEqual([s.ai.waiter.offered, s.ai.waiter.accepted, s.ai.waiter.revenue], [2, 1, 500])
  assert.deepEqual([s.ai.guestMenu.offered, s.ai.guestMenu.accepted, s.ai.guestMenu.revenue], [2, 1, 1500])
  assert.equal(s.ai.share, Math.round((2000 / 6500) * 100))
  assert.deepEqual([s.guestApp.calls, s.guestApp.avgReactionSec, s.guestApp.reviews], [2, 180, 1])
})
