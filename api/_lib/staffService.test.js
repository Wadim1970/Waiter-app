// node --test api/_lib/staffService.test.js — раздел «Официанты» на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { normalizePeriod, upsellStats, aggregate, byDay } from './staffCore.js'

const hall = await import('./hallService.js')
const svc = await import('./staffService.js')

const R = '11111111-1111-1111-1111-111111111111'
const T1 = 'a0000000-0000-0000-0000-000000000001'
const T2 = 'a0000000-0000-0000-0000-000000000002'
const ANNA = 'b0000000-0000-0000-0000-000000000001'
const SERGEY = 'b0000000-0000-0000-0000-000000000002'
const IDLE = 'b0000000-0000-0000-0000-000000000003'
const NOW = new Date('2026-10-23T17:00:00Z') // 23.10, 20:00 МСК

function seed() {
  return fakeDb({
    restaurants: [{ id: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    tables: [
      { id: T1, restaurant_id: R, number: 1, zone: 'main', capacity: 4, is_active: true },
      { id: T2, restaurant_id: R, number: 2, zone: 'main', capacity: 2, is_active: true },
    ],
    waiters: [
      { id: ANNA, first_name: 'Анна', last_name: 'Петрова' },
      { id: SERGEY, first_name: 'Сергей', last_name: 'Иванов' },
      { id: IDLE, first_name: 'Ольга', last_name: 'Смирнова' },
    ],
    restaurant_staff: [
      { waiter_id: ANNA, restaurant_id: R, hire_date: '2026-01-10', dismissal_date: null },
      { waiter_id: IDLE, restaurant_id: R, hire_date: '2026-02-01', dismissal_date: null },
    ],
    waiter_table_assignments: [
      // Стол 2 22.10 закреплён за Сергеем — его посадка без записи уйдёт ему.
      { id: 'as1', table_id: T2, waiter_id: SERGEY, is_permanent: false, assigned_date: '2026-10-22', created_at: '2026-10-22T05:00:00Z' },
    ],
    staff_shifts: [
      { waiter_id: ANNA, restaurant_id: R, shift_date: '2026-10-22' },
      { waiter_id: IDLE, restaurant_id: R, shift_date: '2026-10-23' }, // смена без посадок — тоже рабочий день
      { waiter_id: IDLE, restaurant_id: R, shift_date: '2026-10-21' }, // вне периода
    ],
    table_sessions: [
      { id: 's1', table_id: T1, waiter_id: ANNA, status: 'free', guest_count: 2, started_at: '2026-10-22T08:00:00Z', ended_at: '2026-10-22T09:00:00Z', is_active: false },
      { id: 's2', table_id: T1, waiter_id: ANNA, status: 'free', guest_count: 4, started_at: '2026-10-23T09:00:00Z', ended_at: '2026-10-23T11:00:00Z', is_active: false },
      { id: 's3', table_id: T2, waiter_id: null, status: 'free', guest_count: 2, started_at: '2026-10-22T15:00:00Z', ended_at: '2026-10-22T16:00:00Z', is_active: false },
      { id: 's4', table_id: T2, waiter_id: null, status: 'free', guest_count: 1, started_at: '2026-10-23T08:00:00Z', ended_at: '2026-10-23T08:30:00Z', is_active: false },
      // До периода — не считается.
      { id: 's0', table_id: T1, waiter_id: ANNA, status: 'free', guest_count: 2, started_at: '2026-10-20T08:00:00Z', ended_at: '2026-10-20T09:00:00Z', is_active: false },
    ],
    orders: [
      { id: 'o1', table_id: T1, table_session_id: 's1', status: 'paid', created_at: '2026-10-22T08:05:00Z' },
      { id: 'o2', table_id: T1, table_session_id: 's2', status: 'paid', created_at: '2026-10-23T09:05:00Z' },
      { id: 'o3', table_id: T2, table_session_id: 's3', status: 'paid', created_at: '2026-10-22T15:05:00Z' },
      { id: 'o4', table_id: T2, table_session_id: 's4', status: 'paid', created_at: '2026-10-23T08:05:00Z' },
      { id: 'o0', table_id: T1, table_session_id: 's0', status: 'paid', created_at: '2026-10-20T08:05:00Z' },
    ],
    order_items: [
      { id: 'i1', order_id: 'o1', item_id: 'd1', seat_number: 1, quantity: 2, unit_price: 1000, sent_at: '2026-10-22T08:10:00Z' },
      { id: 'i2', order_id: 'o2', item_id: 'd2', seat_number: 1, quantity: 4, unit_price: 1500, sent_at: '2026-10-23T09:20:00Z' },
      { id: 'i3', order_id: 'o3', item_id: 'd1', seat_number: 1, quantity: 1, unit_price: 1000, sent_at: '2026-10-22T15:04:00Z' },
      { id: 'i4', order_id: 'o4', item_id: 'd3', seat_number: 1, quantity: 1, unit_price: 500 },
      { id: 'i0', order_id: 'o0', item_id: 'd1', seat_number: 1, quantity: 9, unit_price: 1000 },
    ],
    order_item_modifiers: [],
    menu_items: [
      { id: 'd1', restaurant_id: R, dish_name: 'Борщ', cost_rub: 1000 },
      { id: 'd2', restaurant_id: R, dish_name: 'Стейк', cost_rub: 1500 },
      { id: 'd3', restaurant_id: R, dish_name: 'Морс', cost_rub: 500 },
    ],
    modifiers: [],
    waiter_calls: [
      { id: 'c1', table_id: T1, status: 'acknowledged', created_at: '2026-10-22T08:30:00Z', acknowledged_at: '2026-10-22T08:31:00Z', acknowledged_by: ANNA },
      { id: 'c2', table_id: T1, status: 'pending', created_at: '2026-10-23T10:00:00Z' },
    ],
    ai_suggestion_events: [
      { restaurant_id: R, order_id: 'o1', waiter_id: ANNA, dish_id: 'd3', category: 'soft', technique: 'taste_pairing', outcome: 'accepted', created_at: '2026-10-22T08:20:00Z', channel: 'waiter' },
      { restaurant_id: R, order_id: 'o1', waiter_id: ANNA, dish_id: 'd2', category: 'main', technique: 'choice_no_choice', outcome: 'rejected', created_at: '2026-10-22T08:21:00Z', channel: null },
      { restaurant_id: R, order_id: 'o2', waiter_id: ANNA, dish_id: 'd3', category: 'soft', technique: 'taste_pairing', outcome: 'accepted', created_at: '2026-10-23T09:30:00Z', channel: 'waiter' },
      // Подсказка гостю в меню — не официантская.
      { restaurant_id: R, waiter_id: null, dish_id: 'd3', technique: 'taste_pairing', outcome: 'accepted', created_at: '2026-10-23T09:30:00Z', channel: 'guest_menu' },
    ],
    reviews: [{ restaurant_id: R, table_number: '1', rating_food: 5, rating_service: 4, created_at: '2026-10-22T09:10:00Z' }],
    reviews_waiter: [{ restaurant_id: R, waiter_id: ANNA, rating: 5, created_at: '2026-10-22T12:00:00Z' }],
    table_reservations: [],
  })
}

beforeEach(() => {
  hall.deps.db = seed()
  hall.deps.now = () => NOW
})

test('период: по умолчанию сегодня, «по» не раньше «с», не длиннее 92 дней', () => {
  assert.deepEqual(normalizePeriod(undefined, undefined, '2026-10-23').days, ['2026-10-23'])
  assert.equal(normalizePeriod('2026-10-23', '2026-10-01', '2026-10-23').to, '2026-10-23')
  assert.equal(normalizePeriod('2026-10-01', '2026-10-07', '2026-10-23').days.length, 7)
  assert.throws(() => normalizePeriod('2026-01-01', '2026-10-01', '2026-10-23'), (e) => e.status === 400)
})

test('доп. продажи: продано, конверсия, приёмы, блюда, выручка', () => {
  const dishes = new Map([['d1', { name: 'Борщ', price: 1000 }], ['d3', { name: 'Морс', price: 500 }]])
  const u = upsellStats([
    { dish_id: 'd3', technique: 'taste_pairing', category: 'soft', outcome: 'accepted' },
    { dish_id: 'd3', technique: 'taste_pairing', category: 'soft', outcome: 'accepted' },
    { dish_id: 'd1', technique: 'choice_no_choice', category: 'main', outcome: 'rejected' },
    { dish_id: 'd1', technique: null, category: null, outcome: 'ignored' },
  ], dishes)
  assert.equal(u.offered, 4)
  assert.equal(u.accepted, 2)
  assert.equal(u.rate, 50)
  assert.equal(u.revenue, 1000)
  assert.deepEqual(u.byTechnique.map((t) => [t.label, t.offered, t.accepted, t.rate]), [
    ['Сочетание вкусов', 2, 2, 100], ['Выбор без выбора', 1, 0, 0], ['Другое', 1, 0, 0],
  ])
  assert.deepEqual(u.topDishes, [{ name: 'Морс', accepted: 2, revenue: 1000 }])
})

test('итоги и по дням', () => {
  const s = [
    { date: '2026-10-22', total: 2000, guestCount: 2, durationMin: 60, active: false, calls: [{ reactionSec: 60 }, { reactionSec: null }], firstOrderMin: 10, review: { service: 4 } },
    { date: '2026-10-23', total: 0, guestCount: 1, durationMin: 30, active: false, calls: [], firstOrderMin: null, review: null },
  ]
  const a = aggregate(s)
  assert.equal(a.avgCheck, 2000)
  assert.equal(a.unansweredCalls, 1)
  assert.equal(a.avgReactionSec, 60)
  assert.equal(a.avgFirstOrderMin, 10)
  assert.equal(a.serviceRating, 4)
  const d = byDay(s, [{ date: '2026-10-23', outcome: 'accepted' }], ['2026-10-22', '2026-10-23'])
  assert.deepEqual(d.map((x) => [x.date, x.sessions, x.revenue, x.offered, x.accepted]), [['2026-10-22', 1, 2000, 0, 0], ['2026-10-23', 1, 0, 1, 1]])
})

test('список официантов за 22–23.10: посадки, выручка, рабочие дни, доп. продажи, неактивные внизу', async () => {
  const r = await svc.getStaff(R, '2026-10-22', '2026-10-23')
  assert.deepEqual(r.period, { from: '2026-10-22', to: '2026-10-23', days: 2 })
  assert.deepEqual(r.waiters.map((w) => w.name), ['Анна Петрова', 'Сергей Иванов', 'Ольга Смирнова'])
  const [anna, sergey, olga] = r.waiters
  assert.equal(anna.sessions, 2)
  assert.equal(anna.revenue, 2000 + 6000)
  assert.equal(anna.avgCheck, 4000)
  assert.equal(anna.guests, 6)
  assert.equal(anna.workDays, 2) // смена 22 + посадка 23
  assert.equal(anna.upsell.offered, 3)
  assert.equal(anna.upsell.accepted, 2)
  assert.equal(anna.upsell.revenue, 1000)
  assert.equal(anna.avgReactionSec, 60)
  assert.equal(anna.unansweredCalls, 1)
  assert.equal(anna.avgFirstOrderMin, 15) // 10 и 20 мин
  assert.equal(anna.serviceRating, 4)
  assert.equal(anna.rating, 5)
  assert.deepEqual(anna.tables, [1])
  assert.equal(sergey.sessions, 1) // по закреплению 22.10
  assert.equal(sergey.revenue, 1000)
  assert.equal(olga.sessions, 0)
  assert.equal(olga.workDays, 1)
  assert.equal(r.restaurantTotals.sessions, 4)
  assert.equal(r.restaurantTotals.unattributed.sessions, 1) // 23.10 стол 2 — никого
  assert.equal(r.restaurantTotals.upsell.offered, 3) // гостевое меню не считается
})

test('карточка официанта: сравнение с рестораном, по дням, столы, посадки', async () => {
  const r = await svc.getWaiterStats(R, ANNA, '2026-10-22', '2026-10-23')
  assert.equal(r.waiter.name, 'Анна Петрова')
  assert.equal(r.waiter.staff, true)
  assert.equal(r.totals.revenue, 8000)
  assert.equal(r.restaurantTotals.revenue, 8000 + 1000 + 500)
  assert.deepEqual(r.byDay.map((d) => [d.date, d.sessions, d.revenue, d.offered, d.accepted]), [
    ['2026-10-22', 1, 2000, 2, 1], ['2026-10-23', 1, 6000, 1, 1],
  ])
  assert.deepEqual(r.tables.map((t) => [t.number, t.sessions, t.revenue]), [[1, 2, 8000]])
  assert.equal(r.sessions[0].id, 's2') // свежие сверху
  assert.equal(r.sessions[1].calls[0].acknowledgedBy, 'Анна Петрова')
  assert.equal(r.totals.upsell.byTechnique[0].label, 'Сочетание вкусов')
})

test('карточка: чужой официант — 404', async () => {
  hall.deps.db.tables.waiters.push({ id: 'b0000000-0000-0000-0000-000000000009', first_name: 'Чужой' })
  hall.deps.db.tables.restaurant_staff.push({ waiter_id: 'b0000000-0000-0000-0000-000000000009', restaurant_id: '22222222-2222-2222-2222-222222222222', hire_date: '2026-01-01', dismissal_date: null })
  await assert.rejects(() => svc.getWaiterStats(R, 'b0000000-0000-0000-0000-000000000009', '2026-10-22', '2026-10-23'), (e) => e.status === 404)
})
