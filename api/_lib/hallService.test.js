// node --test api/_lib/hallService.test.js — сервис «Зала» на поддельной базе в памяти.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'

const svc = await import('./hallService.js')

const R = '11111111-1111-1111-1111-111111111111'
const T1 = 'a0000000-0000-0000-0000-000000000001'
const T2 = 'a0000000-0000-0000-0000-000000000002'
const T3 = 'a0000000-0000-0000-0000-000000000003'
const W1 = 'b0000000-0000-0000-0000-000000000001'
const W2 = 'b0000000-0000-0000-0000-000000000002'

// «Сейчас» — 22.10.2026 20:00 по Москве.
const NOW = new Date('2026-10-22T17:00:00Z')

function seed() {
  return fakeDb({
    restaurants: [{ restaurantId: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    tables: [
      { id: T1, restaurant_id: R, number: 1, zone: 'main', capacity: 4, is_active: true, layout_x: 10, layout_y: 10, layout_w: 8, layout_h: 8, layout_shape: 'round', layout_rotation: 0 },
      { id: T2, restaurant_id: R, number: 2, zone: 'main', capacity: 2, is_active: true },
      { id: T3, restaurant_id: R, number: 3, zone: 'veranda', capacity: 6, is_active: true },
    ],
    waiters: [
      { id: W1, restaurant_id: R, first_name: 'Анна', last_name: 'Петрова' },
      { id: W2, restaurant_id: null, display_name: 'Демо-официант' },
    ],
    waiter_table_assignments: [
      { id: 'as1', table_id: T1, waiter_id: W1, is_permanent: true, assigned_date: '2026-10-01', created_at: '2026-10-01T00:00:00Z' },
      { id: 'as2', table_id: T3, waiter_id: W2, is_permanent: false, assigned_date: '2026-10-22', created_at: '2026-10-22T05:00:00Z' },
    ],
    staff_shifts: [],
    table_sessions: [
      // Стол 1: обед (закрыта), вечер (идёт сейчас).
      { id: 's1', table_id: T1, waiter_id: W1, status: 'free', guest_count: 3, started_at: '2026-10-22T08:00:00Z', ended_at: '2026-10-22T09:30:00Z', is_active: false },
      { id: 's2', table_id: T1, waiter_id: null, status: 'preparing', guest_count: 2, started_at: '2026-10-22T16:30:00Z', ended_at: null, is_active: true },
      // Стол 2: вчерашняя ночь до 02:00 — уже вчерашний день ресторана, не наш.
      { id: 's0', table_id: T2, waiter_id: null, status: 'free', guest_count: 2, started_at: '2026-10-21T21:00:00Z', ended_at: '2026-10-21T23:00:00Z', is_active: false },
    ],
    orders: [
      { id: 'o1', table_id: T1, table_session_id: 's1', status: 'paid', created_at: '2026-10-22T08:05:00Z' },
      { id: 'o2', table_id: T1, table_session_id: null, status: 'new', created_at: '2026-10-22T16:35:00Z' },
    ],
    order_items: [
      { id: 'i1', order_id: 'o1', item_id: 'd1', seat_number: 1, quantity: 2, unit_price: 830, status: 'sent' },
      { id: 'i2', order_id: 'o1', item_id: 'd2', seat_number: 2, quantity: 1, unit_price: 4170, status: 'sent' },
      { id: 'i3', order_id: 'o2', item_id: 'd1', seat_number: 1, quantity: 1, unit_price: 830, status: 'new' },
    ],
    order_item_modifiers: [{ order_item_id: 'i2', modifier_id: 'm1', price_delta: 160 }],
    menu_items: [{ id: 'd1', dish_name: 'Борщ' }, { id: 'd2', dish_name: 'Стейк Рибай' }],
    modifiers: [{ id: 'm1', name: 'Соус грибной' }],
    waiter_calls: [
      { id: 'c1', table_id: T1, status: 'acknowledged', created_at: '2026-10-22T08:40:00Z', acknowledged_at: '2026-10-22T08:41:00Z', acknowledged_by: W1, reason: 'bill' },
      { id: 'c2', table_id: T1, status: 'pending', created_at: '2026-10-22T16:58:00Z' },
    ],
    ai_suggestion_events: [
      { order_id: 'o1', waiter_id: W1, outcome: 'accepted' },
      { order_id: 'o1', waiter_id: W1, outcome: 'ignored' },
      { order_id: 'o2', waiter_id: W2, outcome: 'rejected' },
    ],
    reviews: [{ restaurant_id: R, table_number: '1', rating_food: 5, rating_service: 5, comment: 'Отлично', created_at: '2026-10-22T09:35:00Z' }],
    table_reservations: [
      { id: 'r1', restaurant_id: R, table_id: T2, starts_at: '2026-10-22T16:00:00Z', ends_at: '2026-10-22T18:00:00Z', guest_count: 3, guest_name: 'Иван', status: 'confirmed' },
      { id: 'r2', restaurant_id: R, table_id: T2, starts_at: '2026-10-23T16:00:00Z', ends_at: '2026-10-23T18:00:00Z', guest_count: 4, guest_name: 'Мария', status: 'confirmed' },
    ],
  })
}

beforeEach(() => {
  svc.deps.db = seed()
  svc.deps.now = () => NOW
})

test('зал сегодня: что сейчас, вызов, закрепления, итоги, брони, сводка', async () => {
  const h = await svc.getHall(R, '2026-10-22')
  assert.equal(h.mode, 'today')
  assert.equal(h.today, '2026-10-22')
  assert.deepEqual(h.zones, ['main', 'veranda'])
  const [t1, t2, t3] = h.tables
  assert.deepEqual(t1.layout, { x: 10, y: 10, w: 8, h: 8, shape: 'round', rotation: 0 })
  assert.equal(t2.layout, null)
  assert.equal(t1.live.sessionId, 's2')
  assert.equal(t1.live.total, 830)
  assert.deepEqual(t1.live.waiter, { id: W2, name: 'Демо-официант', inferred: true }) // по ИИ-событию заказа
  assert.equal(t1.pendingCall, true)
  assert.deepEqual(t1.day, { sessions: 2, guests: 5, revenue: 2 * 830 + 4170 + 160 + 830 })
  assert.deepEqual(t1.assigned.map((a) => [a.name, a.permanent]), [['Анна Петрова', true]])
  assert.deepEqual(t2.assigned, []) // без официанта — админка подсветит
  assert.equal(t2.day.sessions, 0) // ночь на 22-е — день 21-го
  assert.equal(t2.reservations.length, 1)
  assert.deepEqual(t3.assigned.map((a) => a.name), ['Демо-официант'])
  assert.equal(h.summary.sessions, 2)
  assert.equal(h.summary.revenue, 6820)
  assert.ok(h.waiters.some((w) => w.id === W2)) // закреплённый фрилансер — в списке
})

test('зал вчера: ночная посадка относится к 21-му', async () => {
  const h = await svc.getHall(R, '2026-10-21')
  assert.equal(h.mode, 'past')
  assert.equal(h.tables[1].day.sessions, 1)
  assert.equal(h.tables[0].live, null)
  assert.equal(h.tables[0].pendingCall, false)
})

test('зал завтра: только брони, без истории и сводки', async () => {
  const h = await svc.getHall(R, '2026-10-23')
  assert.equal(h.mode, 'future')
  assert.equal(h.summary, null)
  assert.equal(h.tables[1].reservations[0].guestName, 'Мария')
})

test('история стола: посадки с заказом по местам, вызовы, доп. продажи, отзыв; брони вперёд', async () => {
  const t = await svc.getTableDay(R, T1, '2026-10-22')
  assert.equal(t.sessions.length, 2)
  const [lunch, evening] = t.sessions
  assert.equal(lunch.total, 1660 + 4330)
  assert.equal(lunch.durationMin, 90)
  assert.deepEqual(lunch.waiter, { id: W1, name: 'Анна Петрова', inferred: false })
  assert.deepEqual(lunch.items.map((i) => [i.seat, i.name, i.quantity, i.price, i.modifiers]), [
    [1, 'Борщ', 2, 830, []], [2, 'Стейк Рибай', 1, 4330, ['Соус грибной']],
  ])
  assert.deepEqual(lunch.calls.map((c) => [c.reason, c.reactionSec, c.acknowledgedBy]), [['bill', 60, 'Анна Петрова']])
  assert.deepEqual(lunch.upsell, { offered: 2, accepted: 1 })
  assert.equal(lunch.review.comment, 'Отлично')
  assert.equal(evening.active, true)
  assert.equal(evening.review, null)
  assert.equal(evening.calls.length, 1)
  assert.equal(t.summary.sessions, 2)

  const t2 = await svc.getTableDay(R, T2, '2026-10-22')
  assert.deepEqual(t2.reservations.map((r) => r.guestName), ['Иван', 'Мария'])
})

test('стол чужого ресторана — 404', async () => {
  await assert.rejects(() => svc.getTableDay('22222222-2222-2222-2222-222222222222', T1, '2026-10-22'), (e) => e.status === 404)
})

test('бронь: пересечение — 409 с понятным текстом; соседнее время — можно; отменённая не мешает', async () => {
  await assert.rejects(
    () => svc.createReservation(R, { tableId: T2, startsAt: '2026-10-22T17:00:00Z', endsAt: '2026-10-22T19:00:00Z', guestCount: 2 }),
    (e) => e.status === 409 && /Иван, 19:00–21:00/.test(e.message),
  )
  const ok = await svc.createReservation(R, { tableId: T2, startsAt: '2026-10-22T18:00:00Z', endsAt: '2026-10-22T20:00:00Z', guestCount: 2, guestName: ' Олег ' })
  assert.equal(ok.guestName, 'Олег')
  await svc.updateReservation(R, 'r1', { status: 'cancelled' })
  await svc.createReservation(R, { tableId: T2, startsAt: '2026-10-22T16:30:00Z', endsAt: '2026-10-22T17:30:00Z', guestCount: 2 })
  await assert.rejects(() => svc.createReservation(R, { tableId: T2, startsAt: '2026-10-22T18:00:00Z', endsAt: '2026-10-22T17:00:00Z', guestCount: 2 }), (e) => e.status === 400)
})

test('схема: сохранение раскладки, новый стол, занятый номер', async () => {
  await svc.saveLayout(R, [{ id: T2, x: 50, y: 40, w: 10, h: 6, shape: 'rect' }])
  const t2 = svc.deps.db.tables.tables.find((t) => t.id === T2)
  assert.equal(t2.layout_shape, 'rect')
  await assert.rejects(() => svc.saveLayout(R, [{ id: 'zzz', x: 1, y: 1 }]), (e) => e.status === 400)
  await assert.rejects(() => svc.createTable(R, { number: 2 }), (e) => e.status === 409)
  const { id } = await svc.createTable(R, { number: 10, zone: 'veranda', capacity: 2 })
  assert.ok(id)
  await svc.updateTable(R, id, { isActive: false })
  await svc.createTable(R, { number: 10 }) // номер выключенного стола свободен
})

test('закрепление: на дату и снятие', async () => {
  const { id } = await svc.addAssignment(R, { tableId: T2, waiterId: W1, permanent: false, date: '2026-10-22' })
  let h = await svc.getHall(R, '2026-10-22')
  assert.deepEqual(h.tables[1].assigned.map((a) => a.name), ['Анна Петрова'])
  await svc.removeAssignment(R, id)
  h = await svc.getHall(R, '2026-10-22')
  assert.deepEqual(h.tables[1].assigned, [])
  await assert.rejects(() => svc.addAssignment(R, { tableId: T2, waiterId: W1, permanent: false }), (e) => e.status === 400)
})

test('HTTP: токен, restaurantId, ошибки с кодом', async () => {
  process.env.ADMIN_TOKEN = 'secret-token'
  const { default: reservations } = await import('../admin/reservations.js')
  const call = async (method, body, token = 'secret-token') => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(o) { this.body = o; return this }, end() {} }
    await reservations({ method, headers: token ? { 'x-admin-token': token } : {}, query: {}, body }, res)
    return res
  }
  assert.equal((await call('POST', { restaurantId: R }, 'wrong-token!')).statusCode, 401)
  assert.equal((await call('POST', { restaurantId: 'x' })).statusCode, 400)
  assert.equal((await call('GET', {})).statusCode, 405)
  const clash = await call('POST', { restaurantId: R, tableId: T2, startsAt: '2026-10-22T17:00:00Z', endsAt: '2026-10-22T19:00:00Z', guestCount: 2 })
  assert.equal(clash.statusCode, 409)
  assert.match(clash.body.error, /уже забронирован/)
  const ok = await call('POST', { restaurantId: R, tableId: T3, startsAt: '2026-10-22T17:00:00Z', endsAt: '2026-10-22T19:00:00Z', guestCount: 5 })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.body.guestCount, 5)
})

test('доступ: учебный ресторан — без токена, остальные — только с токеном', async () => {
  const { isAdmin } = await import('./http.js')
  const req = (token) => ({ headers: token ? { 'x-admin-token': token } : {} })
  process.env.ADMIN_TOKEN = 'secret-token'
  delete process.env.ADMIN_OPEN_RESTAURANTS
  assert.equal(isAdmin(req(), 'dd89773c-0952-4fd1-9510-514094a928ee'), true)
  assert.equal(isAdmin(req(), R), false)
  assert.equal(isAdmin(req(), ''), false) // действия по всем ресторанам
  assert.equal(isAdmin(req('secret-token'), R), true)
  process.env.ADMIN_OPEN_RESTAURANTS = ''
  assert.equal(isAdmin(req(), 'dd89773c-0952-4fd1-9510-514094a928ee'), false)
  process.env.ADMIN_OPEN_RESTAURANTS = `${R}, other`
  assert.equal(isAdmin(req(), R), true)
  delete process.env.ADMIN_OPEN_RESTAURANTS
})
