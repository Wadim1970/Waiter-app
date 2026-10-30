// node --test api/_lib/reviewsService.test.js — «Жалобы и оценки» на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { classify } from './reviewsCore.js'

const hall = await import('./hallService.js')
const svc = await import('./reviewsService.js')

const R = '11111111-1111-1111-1111-111111111111'
const T1 = 'a0000000-0000-0000-0000-000000000001'
const T2 = 'a0000000-0000-0000-0000-000000000002'
const ANNA = 'b0000000-0000-0000-0000-000000000001'
const OLGA = 'b0000000-0000-0000-0000-000000000002'

beforeEach(() => {
  hall.deps.now = () => new Date('2026-10-25T17:00:00Z')
  hall.deps.db = fakeDb({
    restaurants: [{ id: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    tables: [{ id: T1, restaurant_id: R, number: 1, is_active: true }, { id: T2, restaurant_id: R, number: 2, is_active: true }],
    waiters: [{ id: ANNA, first_name: 'Анна', last_name: 'Петрова' }, { id: OLGA, first_name: 'Ольга', last_name: 'Смирнова' }],
    table_sessions: [
      { id: 's1', table_id: T1, waiter_id: ANNA, guest_count: 2, started_at: '2026-10-24T09:00:00Z', ended_at: '2026-10-24T10:00:00Z', is_active: false },
      { id: 's2', table_id: T2, waiter_id: null, guest_count: 3, started_at: '2026-10-25T09:00:00Z', ended_at: '2026-10-25T10:30:00Z', is_active: false },
    ],
    waiter_table_assignments: [{ id: 'a1', table_id: T2, waiter_id: OLGA, is_permanent: true, assigned_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z' }],
    reviews: [
      { id: 1, restaurant_id: R, table_number: '1', rating_food: 5, rating_service: 5, comment: 'Всё отлично', created_at: '2026-10-24T10:20:00Z' },
      { id: 2, restaurant_id: R, table_number: '2', rating_food: 2, rating_service: 4, comment: 'Холодный суп', created_at: '2026-10-25T10:40:00Z' },
      { id: 3, restaurant_id: R, table_number: '2', rating_food: 0, rating_service: 3, comment: '', created_at: '2026-10-25T10:45:00Z' },
      { id: 4, restaurant_id: R, table_number: '9', rating_food: 4, rating_service: 0, created_at: '2026-10-25T12:00:00Z' }, // стола нет
      { id: 5, restaurant_id: 'другой', table_number: '1', rating_food: 1, rating_service: 1, created_at: '2026-10-25T12:00:00Z' },
    ],
  })
})

test('жалоба — оценка 3 и ниже; 0 — оценки нет', () => {
  assert.deepEqual(classify({ rating_food: 5, rating_service: 4 }), { food: 5, service: 4, complaint: false, severity: null, about: [] })
  assert.deepEqual(classify({ rating_food: 2, rating_service: 0 }), { food: 2, service: null, complaint: true, severity: 'high', about: ['kitchen'] })
  assert.deepEqual(classify({ rating_food: 0, rating_service: 3 }).about, ['service'])
})

test('отзывы за 24–25.10: сводка, жалобы, посадка и официант, распределение', async () => {
  const r = await svc.getReviews(R, '2026-10-24', '2026-10-25')
  assert.equal(r.summary.reviews, 4)
  assert.equal(r.summary.complaints, 2)
  assert.equal(r.summary.unresolved, 2)
  assert.equal(r.summary.food.avg, 3.7) // 5, 2, 4
  assert.equal(r.summary.service.avg, 4) // 5, 4, 3
  assert.deepEqual(r.summary.food.distribution, { 5: 1, 4: 1, 3: 0, 2: 1, 1: 0 })
  const byId = new Map(r.reviews.map((x) => [x.id, x]))
  assert.deepEqual(byId.get(1).waiter, { id: ANNA, name: 'Анна Петрова', inferred: false })
  assert.equal(byId.get(2).session.id, 's2')
  assert.deepEqual(byId.get(2).waiter, { id: OLGA, name: 'Ольга Смирнова', inferred: true })
  assert.equal(byId.get(3).comment, null)
  assert.equal(byId.get(4).session, null)
  assert.deepEqual(r.byWaiter.map((w) => [w.name, w.reviews, w.complaints, w.serviceAvg]), [['Ольга Смирнова', 2, 2, 3.5], ['Анна Петрова', 1, 0, 5]])
  assert.deepEqual(r.byDay.map((d) => [d.date, d.reviews, d.complaints]), [['2026-10-24', 1, 0], ['2026-10-25', 3, 2]])
})

test('жалоба разобрана и снова открыта; чужой отзыв — 404', async () => {
  await svc.resolveReview(R, { id: 2, resolved: true, note: 'Извинились, суп за счёт заведения' })
  let r = await svc.getReviews(R, '2026-10-25', '2026-10-25')
  assert.equal(r.summary.unresolved, 1)
  assert.equal(r.reviews.find((x) => x.id === 2).resolvedNote, 'Извинились, суп за счёт заведения')
  await svc.resolveReview(R, { id: 2, resolved: false })
  r = await svc.getReviews(R, '2026-10-25', '2026-10-25')
  assert.equal(r.summary.unresolved, 2)
  await assert.rejects(() => svc.resolveReview(R, { id: 5, resolved: true }), (e) => e.status === 404)
})

test('визит отзыва: только его посадка — гости по местам, заказ, ожидание блюд, вызовы', async () => {
  const t = hall.deps.db.tables
  t.menu_items = [{ id: 'd1', dish_name: 'Борщ', cook_time_min: 15 }, { id: 'd2', dish_name: 'Морс' }]
  t.orders = [
    { id: 'o1', table_id: T2, table_session_id: 's2', status: 'closed', created_at: '2026-10-25T09:05:00Z' },
    { id: 'o0', table_id: T2, table_session_id: 'чужая', status: 'closed', created_at: '2026-10-25T07:00:00Z' },
  ]
  t.order_items = [
    { id: 'i1', order_id: 'o1', item_id: 'd1', seat_number: 1, quantity: 1, unit_price: 400, status: 'served', sent_at: '2026-10-25T09:06:00Z', ready_at: '2026-10-25T09:31:00Z' },
    { id: 'i2', order_id: 'o1', item_id: 'd2', seat_number: 2, quantity: 2, unit_price: 150, status: 'served', sent_at: '2026-10-25T09:06:00Z', ready_at: null },
    { id: 'i0', order_id: 'o0', item_id: 'd2', seat_number: 1, quantity: 1, unit_price: 150, status: 'served' },
  ]
  t.order_guests = [{ order_id: 'o1', seat_number: 1, device_id: 'dev-anna' }, { order_id: 'o1', seat_number: 2, device_id: 'dev-x' }]
  t.guests = [{ id: 'g1', name: 'Мария', phone: '89991234567', device_id: 'dev-old' }]
  t.guest_devices = [{ device_id: 'dev-anna', guest_id: 'g1' }]
  t.waiter_calls = [
    { id: 'c1', table_id: T2, status: 'done', created_at: '2026-10-25T09:40:00Z', acknowledged_at: '2026-10-25T09:42:30Z', acknowledged_by: OLGA, reason: 'Счёт' },
    { id: 'c0', table_id: T2, status: 'done', created_at: '2026-10-25T07:10:00Z', acknowledged_at: '2026-10-25T07:11:00Z' },
  ]

  const v = await svc.getReviewVisit(R, 2)
  assert.equal(v.review.food, 2)
  assert.equal(v.session.id, 's2')
  assert.equal(v.session.guestCount, 3)
  assert.equal(v.session.total, 700)
  assert.deepEqual(v.session.waiter, { id: OLGA, name: 'Ольга Смирнова', inferred: true })
  assert.deepEqual(v.session.items.map((i) => [i.name, i.waitMin, i.normMin]), [['Борщ', 25, 15], ['Морс', null, null]])
  assert.deepEqual(v.session.calls.map((c) => [c.reason, c.reactionSec, c.acknowledgedBy]), [['Счёт', 150, 'Ольга Смирнова']])
  assert.deepEqual(v.guests, [
    { seat: 1, verified: true, guestId: 'g1', name: 'Мария', phone: '+79991234567' },
    { seat: 2, verified: false, guestId: null, name: null, phone: null },
  ])

  const lost = await svc.getReviewVisit(R, 4) // стола № 9 нет
  assert.equal(lost.session, null)
  await assert.rejects(() => svc.getReviewVisit(R, 5), (e) => e.status === 404)
})
