// node --test api/_lib/cartAdviceService.test.js — совет к корзине и десерт на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'

const pairing = await import('./pairingService.js')
const svc = await import('./cartAdviceService.js')

const R = '11111111-1111-1111-1111-111111111111'
const T7 = 'a0000000-0000-0000-0000-000000000007'
const ANNA = 'b0000000-0000-0000-0000-000000000001'
const D = (n) => `d0000000-0000-0000-0000-00000000000${n}`
let db
let now

function seed() {
  return fakeDb({
    restaurants: [{ id: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    tables: [{ id: T7, restaurant_id: R, number: 7 }],
    menu_items: [
      { id: D(1), restaurant_id: R, dish_name: 'Стейк Рибай', menu_section: 'Горячие блюда', cost_rub: 4170 },
      { id: D(2), restaurant_id: R, dish_name: 'Соус перечный', menu_section: 'Соусы', cost_rub: 150 },
      { id: D(3), restaurant_id: R, dish_name: 'Морс из клюквы', menu_section: 'Напитки', product_type: 'drink', cost_rub: 290 },
      { id: D(4), restaurant_id: R, dish_name: 'Тирамису', menu_section: 'Десерты', cost_rub: 520 },
      { id: D(5), restaurant_id: R, dish_name: 'Медовик с орехами', menu_section: 'Десерты', cost_rub: 480 },
      // Ручная поправка: «Фирменное» — это соус, уместный только на ужин.
      { id: D(6), restaurant_id: R, dish_name: 'Фирменное от шефа', menu_section: 'Хиты', cost_rub: 200, course_role: 'sauce', meal_times: ['dinner'] },
      { id: D(7), restaurant_id: R, dish_name: 'Картофель фри', menu_section: 'Гарниры', cost_rub: 290 },
    ],
    menu_item_costing: [{ dish_id: D(6), restaurant_id: R, push_priority: 3 }],
    menu_pairings: [],
    guests: [{ id: 7, device_id: 'dev-1', dislikes: 'орехи' }],
    guest_dessert_reminders: [],
    ai_suggestion_events: [],
    orders: [], order_guests: [], order_items: [],
    table_sessions: [{ id: 's1', table_id: T7, waiter_id: ANNA, is_active: true }],
    waiter_table_assignments: [],
    waiter_calls: [],
  }, { guest_id_for_device: ({ p_device_id }) => (p_device_id === 'dev-1' ? 7 : null) })
}

beforeEach(() => {
  db = seed()
  pairing.deps.supabase = db
  svc.resetCache()
  now = new Date('2026-10-25T16:00:00Z') // 19:00 МСК — ужин
  svc.clock.now = () => now
})

test('ужин: к стейку — соус; ручная роль и приоритет важнее названия', async () => {
  const a = await svc.cartAdvice({ restaurantId: R, deviceId: 'dev-1', cart: [{ id: D(1) }] })
  assert.deepEqual([a.kind, a.meal, a.gap, a.dish.id], ['suggest', 'dinner', 'sauce', D(6)])
})

test('обед: ручной соус «только на ужин» не предлагаем', async () => {
  now = new Date('2026-10-25T10:00:00Z') // 13:00 МСК
  const a = await svc.cartAdvice({ restaurantId: R, deviceId: 'dev-1', cart: [{ id: D(1) }] })
  assert.equal(a.meal, 'lunch')
  assert.equal(a.dish.id, D(2))
})

test('отказ от соуса и гарнира — дальше напиток; всё есть — десерт, но без орехов для этого гостя', async () => {
  const a = await svc.cartAdvice({ restaurantId: R, deviceId: 'dev-1', cart: [{ id: D(1) }], dismissed: { gaps: ['sauce', 'side'] } })
  assert.equal(a.gap, 'drink')
  const full = await svc.cartAdvice({ restaurantId: R, deviceId: 'dev-1', cart: [{ id: D(1) }, { id: D(2) }, { id: D(3) }, { id: D(7) }], dismissed: { gaps: ['starter'] } })
  assert.deepEqual([full.kind, full.askDessert], ['complete', true])
})

test('ответ про десерт: «нет» — больше не спрашиваем; события пишутся в статистику', async () => {
  await svc.answerDessert({ restaurantId: R, deviceId: 'dev-1', tableNumber: '7', seat: 2, meal: 'dinner', yes: false })
  const full = await svc.cartAdvice({ restaurantId: R, deviceId: 'dev-1', cart: [{ id: D(1) }, { id: D(2) }, { id: D(3) }, { id: D(7) }], dismissed: { gaps: ['starter'] } })
  assert.equal(full.askDessert, false)
  await svc.logAdviceEvent({ restaurantId: R, deviceId: 'dev-1', dishId: D(2), anchorId: D(1), gap: 'sauce', outcome: 'accepted', source: 'rule' })
  await svc.logAdviceEvent({ restaurantId: R, deviceId: 'dev-1', dishId: D(2), gap: 'sauce', outcome: 'bogus' })
  assert.deepEqual(db.tables.ai_suggestion_events.map((e) => [e.channel, e.tag, e.outcome]), [['guest_cart', 'dessert_ask', 'rejected'], ['guest_cart', 'sauce', 'accepted']])
})

test('напоминание: горячее готово +20 минут — вызов официанту «десерт», гостю — десерты без орехов, один раз', async () => {
  await svc.answerDessert({ restaurantId: R, deviceId: 'dev-1', tableNumber: '7', seat: 2, meal: 'dinner', yes: true })
  const rem = db.tables.guest_dessert_reminders[0]
  rem.created_at = '2026-10-25T16:00:00Z'
  db.tables.orders.push({ id: 'o1', table_id: T7, created_at: '2026-10-25T16:01:00Z' })
  db.tables.order_guests.push({ order_id: 'o1', seat_number: 2, device_id: 'dev-1' })
  db.tables.order_items.push(
    { order_id: 'o1', item_id: D(1), seat_number: 2, status: 'sent', ready_at: null },
    { order_id: 'o1', item_id: D(3), seat_number: 2, status: 'sent', ready_at: null }, // напиток не ждём
    { order_id: 'o1', item_id: D(1), seat_number: 1, status: 'ready', ready_at: '2026-10-25T16:10:00Z' }, // чужое место
  )
  now = new Date('2026-10-25T16:30:00Z')
  assert.equal((await svc.tickDessertReminders()).called, 0) // стейк ещё готовится
  assert.equal((await svc.guestDessert({ restaurantId: R, deviceId: 'dev-1' })).due, false)

  db.tables.order_items[0].ready_at = '2026-10-25T16:35:00Z'
  now = new Date('2026-10-25T16:50:00Z')
  assert.equal((await svc.tickDessertReminders()).called, 0) // 16:35 + 20 = 16:55
  now = new Date('2026-10-25T16:56:00Z')
  const tick = await svc.tickDessertReminders()
  assert.equal(tick.called, 1)
  const call = db.tables.waiter_calls[0]
  assert.deepEqual([call.kind, call.status, call.table_number, call.target_waiter_id], ['dessert', 'pending', '7', ANNA])
  assert.match(call.reason, /месте 2/)

  const g = await svc.guestDessert({ restaurantId: R, deviceId: 'dev-1' })
  assert.equal(g.due, true)
  assert.deepEqual(g.desserts.map((d) => d.name), ['Тирамису'])
  assert.match(g.text, /к ужину/)
  assert.equal((await svc.guestDessert({ restaurantId: R, deviceId: 'dev-1' })).due, false)
})

test('гость ушёл — напоминание закрывается без вызова', async () => {
  await svc.answerDessert({ restaurantId: R, deviceId: 'dev-1', tableNumber: '7', seat: 1, meal: 'dinner', yes: true })
  db.tables.table_sessions[0].is_active = false
  now = new Date('2026-10-25T18:00:00Z')
  const t = await svc.tickDessertReminders()
  assert.deepEqual([t.called, t.closed], [0, 1])
  assert.equal(db.tables.waiter_calls.length, 0)
})
