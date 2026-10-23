// node --test api/_lib/hallCore.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  businessDay, businessDateOf, zonedTime, orderItemsTotal, resolveSessionWaiter, assignmentsForDate,
  buildSession, ordersOfSession, daySummary, reservationConflict, sanitizeLayout, isDateStr,
} from './hallCore.js'

test('день ресторана: 06:00–06:00 по Москве (UTC+3)', () => {
  const d = businessDay('2026-10-22', 'Europe/Moscow')
  assert.equal(d.from.toISOString(), '2026-10-22T03:00:00.000Z')
  assert.equal(d.to.toISOString(), '2026-10-23T03:00:00.000Z')
})

test('день ресторана: переход на летнее время (Берлин, 29 марта 2026)', () => {
  // 06:00 по Берлину 29.03 — уже летнее время (UTC+2).
  assert.equal(zonedTime('2026-03-29', 6, 'Europe/Berlin').toISOString(), '2026-03-29T04:00:00.000Z')
  assert.equal(zonedTime('2026-03-28', 6, 'Europe/Berlin').toISOString(), '2026-03-28T05:00:00.000Z')
})

test('ночная посадка в 01:30 относится к вечеру предыдущей даты', () => {
  assert.equal(businessDateOf(new Date('2026-10-22T22:30:00Z'), 'Europe/Moscow'), '2026-10-22') // 01:30 23.10 МСК
  assert.equal(businessDateOf(new Date('2026-10-23T03:30:00Z'), 'Europe/Moscow'), '2026-10-23') // 06:30 23.10 МСК
})

test('isDateStr', () => {
  assert.ok(isDateStr('2026-10-22'))
  assert.ok(!isDateStr('2026-13-45'))
  assert.ok(!isDateStr('22.10.2026'))
})

test('чек: количество × (цена + модификаторы)', () => {
  const items = [{ id: 'a', quantity: 2, unit_price: 500 }, { id: 'b', quantity: 1, unit_price: 990 }]
  const mods = new Map([['b', [{ price_delta: 150 }, { price_delta: 50 }]]])
  assert.equal(orderItemsTotal(items, mods), 2 * 500 + 990 + 200)
})

test('кто обслуживал: записан → по ИИ-событиям → по закреплению', () => {
  assert.deepEqual(resolveSessionWaiter({ waiter_id: 'w1' }, { eventWaiterIds: ['w2'], assignedWaiterId: 'w3' }), { id: 'w1', inferred: false })
  assert.deepEqual(resolveSessionWaiter({ waiter_id: null }, { eventWaiterIds: [null, 'w2'], assignedWaiterId: 'w3' }), { id: 'w2', inferred: true })
  assert.deepEqual(resolveSessionWaiter({ waiter_id: null }, { assignedWaiterId: 'w3' }), { id: 'w3', inferred: true })
  assert.deepEqual(resolveSessionWaiter({ waiter_id: null }), { id: null, inferred: false })
})

test('закрепления на дату: на дату важнее «навсегда», без повторов', () => {
  const rows = [
    { table_id: 't1', waiter_id: 'perm', is_permanent: true, created_at: '2026-10-01' },
    { table_id: 't1', waiter_id: 'today', is_permanent: false, assigned_date: '2026-10-22', created_at: '2026-10-22' },
    { table_id: 't1', waiter_id: 'old', is_permanent: false, assigned_date: '2026-10-21', created_at: '2026-10-21' },
    { table_id: 't1', waiter_id: 'perm', is_permanent: true, created_at: '2026-10-05' },
  ]
  const m = assignmentsForDate(rows, '2026-10-22')
  assert.deepEqual(m.get('t1').map((a) => a.waiter_id), ['today', 'perm'])
})

test('заказы посадки: по table_session_id, старые — по столу и времени', () => {
  const s = { id: 's1', table_id: 't1', started_at: '2026-10-22T08:00:00Z', ended_at: '2026-10-22T09:30:00Z', is_active: false }
  const orders = [
    { id: 'o1', table_session_id: 's1', table_id: 't1', created_at: '2026-10-22T12:00:00Z' },
    { id: 'o2', table_session_id: null, table_id: 't1', created_at: '2026-10-22T07:59:00Z' }, // за минуту до — наш
    { id: 'o3', table_session_id: null, table_id: 't1', created_at: '2026-10-22T09:45:00Z' }, // после — не наш
    { id: 'o4', table_session_id: 's2', table_id: 't1', created_at: '2026-10-22T08:30:00Z' }, // чужая посадка
  ]
  assert.deepEqual(ordersOfSession(s, orders).map((o) => o.id), ['o1', 'o2'])
})

test('посадка целиком: чек, места, официант, вызовы, доп. продажи, отзыв', () => {
  const s = { id: 's1', table_id: 't1', waiter_id: null, status: 'free', guest_count: 0, started_at: '2026-10-22T08:00:00Z', ended_at: '2026-10-22T09:30:00Z', is_active: false }
  const out = buildSession(s, {
    orders: [{ id: 'o1' }],
    itemsByOrder: new Map([['o1', [
      { id: 'i1', item_id: 'd1', seat_number: 2, quantity: 1, unit_price: 990 },
      { id: 'i2', item_id: 'd2', seat_number: 1, quantity: 2, unit_price: 300 },
    ]]]),
    modsByItem: new Map([['i1', [{ modifier_id: 'm1', price_delta: 100 }]]]),
    dishNames: new Map([['d1', 'Стейк'], ['d2', 'Морс']]),
    modifierNames: new Map([['m1', 'Соус перечный']]),
    calls: [{ created_at: '2026-10-22T08:10:00Z', acknowledged_at: '2026-10-22T08:11:30Z', acknowledged_by: 'w1', reason: 'bill' }],
    events: [{ waiter_id: 'w1', outcome: 'accepted' }, { waiter_id: 'w1', outcome: 'rejected' }],
    reviews: [{ rating_food: 5, rating_service: 4, comment: 'Вкусно' }],
    waiters: new Map([['w1', { first_name: 'Анна', last_name: 'Петрова' }]]),
  })
  assert.equal(out.total, 1090 + 600)
  assert.equal(out.guestCount, 2) // guest_count пуст — по местам
  assert.equal(out.durationMin, 90)
  assert.deepEqual(out.waiter, { id: 'w1', name: 'Анна Петрова', inferred: true })
  assert.deepEqual(out.items.map((i) => [i.seat, i.name, i.price, i.modifiers]), [[1, 'Морс', 300, []], [2, 'Стейк', 1090, ['Соус перечный']]])
  assert.equal(out.calls[0].reactionSec, 90)
  assert.deepEqual(out.upsell, { offered: 2, accepted: 1 })
  assert.deepEqual(out.review, { food: 5, service: 4, comment: 'Вкусно' })
})

test('сводка дня', () => {
  const s = [
    { total: 4000, guestCount: 2, durationMin: 60, active: false },
    { total: 2000, guestCount: 2, durationMin: 120, active: false },
    { total: 0, guestCount: 1, durationMin: 10, active: true },
  ]
  assert.deepEqual(daySummary(s, 4), { sessions: 3, guests: 5, revenue: 6000, avgCheck: 3000, avgGuestCheck: 1200, turnsPerTable: 0.8, avgDurationMin: 90 })
})

test('конфликт брони: пересечение на том же столе, отменённые не мешают', () => {
  const ex = [
    { id: 'r1', table_id: 't1', starts_at: '2026-10-22T16:00:00Z', ends_at: '2026-10-22T18:00:00Z', status: 'confirmed' },
    { id: 'r2', table_id: 't1', starts_at: '2026-10-22T18:00:00Z', ends_at: '2026-10-22T20:00:00Z', status: 'cancelled' },
  ]
  assert.equal(reservationConflict({ table_id: 't1', starts_at: '2026-10-22T17:00:00Z', ends_at: '2026-10-22T19:00:00Z' }, ex)?.id, 'r1')
  assert.equal(reservationConflict({ table_id: 't1', starts_at: '2026-10-22T18:00:00Z', ends_at: '2026-10-22T19:00:00Z' }, ex), null)
  assert.equal(reservationConflict({ id: 'r1', table_id: 't1', starts_at: '2026-10-22T16:30:00Z', ends_at: '2026-10-22T17:30:00Z' }, ex), null)
  assert.equal(reservationConflict({ table_id: 't2', starts_at: '2026-10-22T17:00:00Z', ends_at: '2026-10-22T19:00:00Z' }, ex), null)
})

test('раскладка: границы зала и допустимые формы', () => {
  assert.deepEqual(sanitizeLayout({ x: -5, y: 120, w: 1, h: 90, shape: 'star', rotation: 270 }),
    { layout_x: 0, layout_y: 100, layout_w: 2, layout_h: 60, layout_shape: null, layout_rotation: 180 })
  assert.deepEqual(sanitizeLayout({ x: 10.5, y: 20, w: 8, h: 8, shape: 'round' }),
    { layout_x: 10.5, layout_y: 20, layout_w: 8, layout_h: 8, layout_shape: 'round', layout_rotation: 0 })
})
