// node --test api/_lib/bookingsService.test.js — раздел «Брони» на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { normalizePhone, birthdayNear, loyaltyDemo, guestHistory } from './bookingsCore.js'

const hall = await import('./hallService.js')
const svc = await import('./bookingsService.js')

const R = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const T1 = 'a0000000-0000-0000-0000-000000000001'
const T2 = 'a0000000-0000-0000-0000-000000000002'
const TX = 'a0000000-0000-0000-0000-00000000000f' // стол другого ресторана
const ANNA = 'b0000000-0000-0000-0000-000000000001'
const NOW = new Date('2026-10-23T09:00:00Z') // 23.10, 12:00 МСК
let db

function seed() {
  return fakeDb({
    restaurants: [{ id: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }, { id: OTHER, name: 'Другой', timezone: 'Europe/Moscow' }],
    tables: [
      { id: T1, restaurant_id: R, number: 1, zone: 'main', capacity: 4, is_active: true, layout_x: 10, layout_y: 10 },
      { id: T2, restaurant_id: R, number: 2, zone: 'veranda', capacity: 2, is_active: true },
      { id: TX, restaurant_id: OTHER, number: 1, zone: 'main', capacity: 4, is_active: true },
    ],
    waiters: [{ id: ANNA, first_name: 'Анна', last_name: 'Петрова' }],
    // Мария — в приложении, день рождения 25.10, два визита (в одном — с подругой на месте 2).
    guests: [{ id: 7, name: 'Мария', phone: '+79031112233', device_id: 'dev-new', points: 120, birthday_day: 25, birthday_month: 10, dislikes: 'кинза', created_at: '2026-08-01T10:00:00Z' }],
    guest_devices: [{ device_id: 'dev-old', guest_id: 7 }, { device_id: 'dev-new', guest_id: 7 }],
    table_sessions: [
      { id: 's1', table_id: T1, waiter_id: ANNA, guest_count: 2, started_at: '2026-10-01T16:00:00Z' },
      { id: 's2', table_id: T2, waiter_id: ANNA, guest_count: 1, started_at: '2026-10-10T16:00:00Z' },
      { id: 's3', table_id: T1, waiter_id: null, guest_count: 3, started_at: '2026-10-15T16:10:00Z' }, // пришли по брони Олега
      { id: 'sx', table_id: TX, waiter_id: null, guest_count: 2, started_at: '2026-10-05T16:00:00Z' },
    ],
    orders: [
      { id: 'o1', table_id: T1, table_session_id: 's1', restaurant_id: R, status: 'paid', created_at: '2026-10-01T16:05:00Z' },
      { id: 'o2', table_id: T2, table_session_id: 's2', restaurant_id: R, status: 'paid', created_at: '2026-10-10T16:05:00Z' },
      { id: 'o3', table_id: T1, table_session_id: 's3', restaurant_id: R, status: 'paid', created_at: '2026-10-15T16:15:00Z' },
      { id: 'ox', table_id: TX, table_session_id: 'sx', restaurant_id: OTHER, status: 'paid', created_at: '2026-10-05T16:05:00Z' },
    ],
    order_guests: [
      { order_id: 'o1', seat_number: 1, device_id: 'dev-old' },
      { order_id: 'o1', seat_number: 2, device_id: 'someone-else' },
      { order_id: 'o2', seat_number: 1, device_id: 'dev-new' },
      { order_id: 'ox', seat_number: 1, device_id: 'dev-new' }, // другой ресторан — не показываем
    ],
    order_items: [
      { id: 'i1', order_id: 'o1', item_id: 'd1', seat_number: 1, quantity: 1, unit_price: 800 },
      { id: 'i2', order_id: 'o1', item_id: 'd2', seat_number: 2, quantity: 1, unit_price: 3000 }, // подруга
      { id: 'i3', order_id: 'o2', item_id: 'd1', seat_number: 1, quantity: 2, unit_price: 800 },
      { id: 'i4', order_id: 'o2', item_id: 'd3', seat_number: 1, quantity: 1, unit_price: 400 },
      { id: 'i5', order_id: 'o3', item_id: 'd2', seat_number: 1, quantity: 2, unit_price: 3000 },
      { id: 'i6', order_id: 'o3', item_id: 'd3', seat_number: 2, quantity: 1, unit_price: 400 },
      { id: 'ix', order_id: 'ox', item_id: 'dx', seat_number: 1, quantity: 1, unit_price: 9999 },
    ],
    order_item_modifiers: [{ order_item_id: 'i4', price_delta: 100 }],
    menu_items: [
      { id: 'd1', restaurant_id: R, dish_name: 'Борщ' },
      { id: 'd2', restaurant_id: R, dish_name: 'Стейк' },
      { id: 'd3', restaurant_id: R, dish_name: 'Морс' },
      { id: 'dx', restaurant_id: OTHER, dish_name: 'Чужое' },
    ],
    guest_restaurant_stats: [{ guest_id: 7, restaurant_id: R, tags: { 'мясное': 1, 'супы': 3 }, top_dishes: [] }],
    reviews: [{ id: 1, restaurant_id: R, session_id: 's2', rating_food: 5, rating_service: 5, comment: 'Всё отлично', created_at: '2026-10-10T18:00:00Z' }],
    table_reservations: [
      // Сегодня: Мария (номер записан как попало) и Олег (не в приложении, раз пришёл, раз не пришёл).
      { id: 'r1', restaurant_id: R, table_id: T1, starts_at: '2026-10-23T16:00:00Z', ends_at: '2026-10-23T18:00:00Z', guest_count: 2, guest_name: 'Маша', guest_phone: '8 (903) 111-22-33', status: 'confirmed', created_at: '2026-10-20T10:00:00Z' },
      { id: 'r2', restaurant_id: R, table_id: T2, starts_at: '2026-10-23T17:00:00Z', ends_at: '2026-10-23T19:00:00Z', guest_count: 3, guest_name: 'Олег', guest_phone: '+7 916 000-00-00', status: 'confirmed', created_at: '2026-10-21T10:00:00Z' },
      { id: 'r3', restaurant_id: R, table_id: null, starts_at: '2026-10-23T18:00:00Z', ends_at: '2026-10-23T20:00:00Z', guest_count: 4, guest_name: 'Новый', guest_phone: null, status: 'confirmed', created_at: '2026-10-22T10:00:00Z' },
      { id: 'h1', restaurant_id: R, table_id: T1, starts_at: '2026-10-15T16:00:00Z', ends_at: '2026-10-15T18:00:00Z', guest_count: 3, guest_name: 'Олег', guest_phone: '79160000000', status: 'seated', created_at: '2026-10-14T10:00:00Z' },
      { id: 'h2', restaurant_id: R, table_id: T2, starts_at: '2026-10-18T16:00:00Z', ends_at: '2026-10-18T18:00:00Z', guest_count: 2, guest_name: 'Олег', guest_phone: '+79160000000', status: 'no_show', created_at: '2026-10-17T10:00:00Z' },
      // Через неделю и за пределами 30 дней.
      { id: 'f1', restaurant_id: R, table_id: T1, starts_at: '2026-10-30T16:00:00Z', ends_at: '2026-10-30T18:00:00Z', guest_count: 6, guest_name: 'Маша', guest_phone: '+79031112233', status: 'confirmed', created_at: '2026-10-22T10:00:00Z' },
      { id: 'f2', restaurant_id: R, table_id: T1, starts_at: '2026-12-01T16:00:00Z', ends_at: '2026-12-01T18:00:00Z', guest_count: 2, guest_name: 'Далеко', guest_phone: null, status: 'confirmed', created_at: '2026-10-22T10:00:00Z' },
      { id: 'c1', restaurant_id: R, table_id: T2, starts_at: '2026-10-30T16:00:00Z', ends_at: '2026-10-30T18:00:00Z', guest_count: 2, guest_name: 'Отмена', guest_phone: null, status: 'cancelled', created_at: '2026-10-22T10:00:00Z' },
    ],
  })
}

beforeEach(() => {
  db = seed()
  hall.deps.db = db
  hall.deps.now = () => NOW
})

test('телефон в одном виде', () => {
  assert.equal(normalizePhone('8 (903) 111-22-33'), '+79031112233')
  assert.equal(normalizePhone('+7 903 111 22 33'), '+79031112233')
  assert.equal(normalizePhone('9031112233'), '+79031112233')
  assert.equal(normalizePhone('+375 29 123-45-67'), '+375291234567')
  assert.equal(normalizePhone('123'), null)
  assert.equal(normalizePhone(null), null)
})

test('день рождения рядом с датой брони, через Новый год', () => {
  assert.equal(birthdayNear(25, 10, '2026-10-23'), 2)
  assert.equal(birthdayNear(20, 10, '2026-10-23'), -3)
  assert.equal(birthdayNear(2, 1, '2026-12-30'), 3)
  assert.equal(birthdayNear(1, 12, '2026-10-23'), null)
})

test('демо-лояльность: уровень по визитам, до следующего', () => {
  assert.equal(loyaltyDemo({ visits: 0, spent: 0, appRegistered: false }), null)
  const l = loyaltyDemo({ visits: 4, spent: 10000, appRegistered: true })
  assert.deepEqual([l.level.name, l.next.name, l.next.visitsLeft, l.balance, l.demo], ['Серебро', 'Золото', 2, 500, true])
  assert.equal(loyaltyDemo({ visits: 0, spent: 0, appRegistered: true }).level, null)
})

test('история: визиты, средний чек, любимые блюда, брони', () => {
  const h = guestHistory({
    visits: [
      { id: 'a', startedAt: '2026-10-01', spent: 1000, guestCount: 2, tableNumber: 1, items: [{ name: 'Борщ', quantity: 1 }] },
      { id: 'b', startedAt: '2026-10-05', spent: 3000, guestCount: 4, tableNumber: 1, items: [{ name: 'Борщ', quantity: 2 }, { name: 'Морс', quantity: 1 }] },
    ],
    reservations: [{ startsAt: '2026-10-01', status: 'seated' }, { startsAt: '2026-10-03', status: 'no_show' }, { startsAt: '2026-11-01', status: 'confirmed' }],
    now: new Date('2026-10-23'),
  })
  assert.deepEqual([h.visits, h.spent, h.avgCheck, h.avgParty, h.firstVisit, h.lastVisit], [2, 4000, 2000, 3, '2026-10-01', '2026-10-05'])
  assert.deepEqual(h.topDishes[0], { name: 'Борщ', times: 3, visits: 2 })
  assert.deepEqual(h.favoriteTables, [{ number: 1, times: 2 }])
  assert.deepEqual(h.reservations, { total: 3, came: 1, noShow: 1, cancelled: 0 })
})

test('брони на сегодня: столы, отметки гостей, календарь на 30 дней', async () => {
  const b = await svc.getBookings(R)
  assert.deepEqual([b.today, b.date, b.maxDate], ['2026-10-23', '2026-10-23', '2026-11-22'])
  assert.equal(b.calendar.length, 31)
  assert.deepEqual(b.calendar[0], { date: '2026-10-23', reservations: 3, guests: 9, known: 2 })
  // Отменённая бронь в календаре не считается, бронь через 39 дней — не попадает.
  assert.deepEqual(b.calendar.find((d) => d.date === '2026-10-30'), { date: '2026-10-30', reservations: 1, guests: 6, known: 1 })

  const t1 = b.tables.find((t) => t.number === 1)
  assert.deepEqual(t1.layout && [t1.layout.x, t1.layout.y], [10, 10])
  const maria = t1.reservations[0].guest
  assert.deepEqual([maria.known, maria.app, maria.regular, maria.visits, maria.birthdayIn, maria.loyalty, maria.noShows], [true, true, false, 2, 2, 'Бронза', 0])
  const oleg = b.tables.find((t) => t.number === 2).reservations[0].guest
  assert.deepEqual([oleg.known, oleg.app, oleg.visits, oleg.noShows, oleg.loyalty], [true, false, 1, 1, 'Бронза'])
  assert.deepEqual(b.reservations.map((r) => [r.guestName, r.tableNumber, r.guest.known]), [['Маша', 1, true], ['Олег', 2, true], ['Новый', null, false]])
})

test('дата за пределами 30 дней и в прошлом — к границе', async () => {
  assert.equal((await svc.getBookings(R, '2027-01-01')).date, '2026-11-22')
  assert.equal((await svc.getBookings(R, '2026-10-01')).date, '2026-10-23')
})

test('карточка гостя приложения: только этот ресторан, своё место, отзывы', async () => {
  const c = await svc.getBookingGuest(R, '8-903-111-22-33')
  assert.equal(c.found, true)
  assert.equal(c.name, 'Мария')
  assert.deepEqual([c.app.points, c.app.birthdayDay, c.app.dislikes], [120, 25, 'кинза'])
  // Визит 1 — только её борщ (не стейк подруги); визит 2 — 2 борща + морс с добавкой; чужой ресторан не считается.
  assert.deepEqual([c.history.visits, c.history.spent, c.history.avgCheck], [2, 800 + 1600 + 500, 1450])
  assert.deepEqual(c.history.topDishes.map((d) => [d.name, d.times]), [['Борщ', 3], ['Морс', 1]])
  assert.deepEqual(c.history.waiters.map((w) => w.name), ['Анна Петрова'])
  assert.deepEqual(c.tastes, ['супы', 'мясное'])
  assert.deepEqual(c.upcoming.map((r) => r.id), ['r1', 'f1'])
  assert.deepEqual(c.reviews.map((r) => r.comment), ['Всё отлично'])
  assert.equal(c.loyalty.level.name, 'Бронза')
})

test('карточка гостя без приложения — по прошлым броням', async () => {
  const c = await svc.getBookingGuest(R, '+7 916 000-00-00')
  assert.equal(c.app, null)
  assert.equal(c.name, 'Олег')
  // Пришёл по брони 15.10 — счёт всего стола.
  assert.deepEqual([c.history.visits, c.history.spent, c.visits[0].scope], [1, 6400, 'table'])
  assert.deepEqual(c.history.reservations, { total: 3, came: 1, noShow: 1, cancelled: 0 })
})

test('неизвестный номер и мусор', async () => {
  assert.equal((await svc.getBookingGuest(R, '+7 999 999-99-99')).found, false)
  await assert.rejects(() => svc.getBookingGuest(R, 'abc'), (e) => e.status === 400)
})

test('бронь: номер приводится к одному виду, дальше 30 дней — нельзя', async () => {
  const r = await hall.createReservation(R, { tableId: T2, startsAt: '2026-10-25T16:00:00Z', endsAt: '2026-10-25T18:00:00Z', guestCount: 2, guestPhone: '8 903 111 22 33' })
  assert.equal(r.guestPhone, '+79031112233')
  await assert.rejects(() => hall.createReservation(R, { tableId: T2, startsAt: '2026-11-23T16:00:00Z', endsAt: '2026-11-23T18:00:00Z', guestCount: 2 }), (e) => e.status === 400 && /30 дней/.test(e.message))
  // Правка старой брони без смены времени — можно.
  await hall.updateReservation(R, 'f1', { comment: 'у окна' })
})
