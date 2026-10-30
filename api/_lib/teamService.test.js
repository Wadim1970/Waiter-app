// node --test api/_lib/teamService.test.js — сектор «Официанты» на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { jobFields, jobDates, weekOf } from './teamCore.js'

const hall = await import('./hallService.js')
const svc = await import('./teamService.js')

const R = '11111111-1111-1111-1111-111111111111'
const ANNA = 'b0000000-0000-0000-0000-000000000001'
const IVAN = 'b0000000-0000-0000-0000-000000000002'
const OLGA = 'b0000000-0000-0000-0000-000000000003'
const J1 = 'e0000000-0000-0000-0000-000000000001' // прошедшая смена
const J2 = 'e0000000-0000-0000-0000-000000000002' // будущая
const B1 = 'f0000000-0000-0000-0000-000000000001'
const B2 = 'f0000000-0000-0000-0000-000000000002'
const B3 = 'f0000000-0000-0000-0000-000000000003'

const job = (id, date, extra = {}) => ({
  id, restaurant_id: R, shift_date: date, start_time: '10:00:00', end_time: '22:00:00', slots_total: 2, slots_available: 2,
  pay_amount: 3500, dress_code: 'Чёрный верх', duties: 'Обслуживание зала', created_at: `${date}T08:00:00Z`, ...extra,
})

beforeEach(() => {
  hall.deps.now = () => new Date('2026-10-30T12:00:00Z')
  hall.deps.db = fakeDb({
    restaurants: [{ id: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    waiters: [
      { id: ANNA, first_name: 'Анна', last_name: 'Петрова', phone: '+79990000001', phone_verified: true },
      { id: IVAN, first_name: 'Иван', last_name: 'Козлов', phone: '+79990000002', phone_verified: true, rating: 4.5 },
      { id: OLGA, first_name: '', phone: '+79990000003', phone_verified: true },
    ],
    restaurant_staff: [{ id: 's1', restaurant_id: R, waiter_id: ANNA, role: 'waiter', hire_date: '2026-01-10', dismissal_date: null }],
    jobs: [job(J1, '2026-10-28'), job(J2, '2026-11-02', { slots_available: 1 })],
    bookings: [
      { id: B1, job_id: J1, worker_id: IVAN, status: 'confirmed', created_at: '2026-10-25T10:00:00Z' },
      { id: B2, job_id: J2, worker_id: IVAN, status: 'confirmed', created_at: '2026-10-29T10:00:00Z' },
      { id: B3, job_id: J2, worker_id: OLGA, status: 'applied', created_at: '2026-10-29T11:00:00Z' },
    ],
    staff_shifts: [{ waiter_id: IVAN, job_id: J1, checked_in_at: '2026-10-28T07:00:00Z' }],
    waiter_reviews: [],
    staff_schedule: [],
  })
})

test('условия заявки и даты повтора', () => {
  const f = jobFields({ startTime: '10:00', endTime: '22:00', slots: 2, pay: '3500', dressCode: ' Чёрный верх ' })
  assert.equal(f.dress_code, 'Чёрный верх')
  assert.equal(f.nutrition, null)
  assert.throws(() => jobFields({ startTime: '25:00', endTime: '22:00', slots: 1, pay: 1 }), /ЧЧ:ММ/)
  assert.deepEqual(jobDates(['2026-11-03', '2026-11-01', '2026-11-03'], '2026-10-30'), ['2026-11-01', '2026-11-03'])
  assert.throws(() => jobDates(['2026-10-29'], '2026-10-30'), /прошла/)
  assert.deepEqual(weekOf('2026-10-30'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'])
})

test('штат: добавить по телефону (нового и зарегистрированного), правка, увольнение', async () => {
  const added = await svc.addStaff(R, { lastName: 'Смирнов', firstName: 'Олег', phone: '8 (999) 111-22-33' })
  assert.equal(added.existing, false)
  const w = hall.deps.db.tables.waiters.find((x) => x.phone === '+79991112233')
  assert.equal(w.last_name, 'Смирнов')
  // Ольга уже в приложении, имени не указала — подставляем; телефон тот же.
  const o = await svc.addStaff(R, { lastName: 'Иванова', firstName: 'Ольга', phone: '+7 999 000-00-03', role: 'senior_waiter' })
  assert.equal(o.existing, true)
  assert.equal(hall.deps.db.tables.waiters.find((x) => x.id === OLGA).first_name, 'Ольга')
  await assert.rejects(() => svc.addStaff(R, { lastName: 'П', firstName: 'А', phone: '+79990000001' }), (e) => e.status === 409)
  await assert.rejects(() => svc.addStaff(R, { lastName: 'П', firstName: 'А', phone: '123' }), (e) => e.status === 400)

  let t = await svc.getTeam(R)
  assert.deepEqual(t.staff.map((s) => s.name), ['Иванова Ольга', 'Петрова Анна', 'Смирнов Олег'])
  // Подтверждённый телефон не меняем, неподтверждённый — можно.
  await assert.rejects(() => svc.updateStaff(R, { id: 's1', phone: '+79995550000' }), (e) => e.status === 409)
  await svc.updateStaff(R, { id: added.id, phone: '+79995550000', middleName: 'Петрович' })
  await svc.updateStaff(R, { id: 's1', dismissed: true })
  t = await svc.getTeam(R)
  assert.deepEqual(t.dismissed.map((s) => [s.name, s.dismissalDate]), [['Петрова Анна', '2026-10-30']])
  assert.equal(t.staff.find((s) => s.lastName === 'Смирнов').phone, '+79995550000')
  // Снова в штат — та же строка.
  await svc.addStaff(R, { lastName: 'Петрова', firstName: 'Анна', phone: '+79990000001' })
  assert.equal(hall.deps.db.tables.restaurant_staff.filter((s) => s.waiter_id === ANNA).length, 1)
})

test('заявки: список с откликами, образец, повтор на даты, правка, снятие', async () => {
  let j = await svc.getJobs(R)
  assert.deepEqual(j.upcoming.map((x) => [x.date, x.bookings.map((b) => `${b.waiter.name}:${b.status}`)]), [['2026-11-02', ['Козлов Иван:confirmed', ':applied'.replace(':', 'Без имени:')]]])
  assert.equal(j.past[0].id, J1)
  assert.equal(j.template.dressCode, 'Чёрный верх')
  assert.equal(j.template.date, null)

  const { ids } = await svc.createJobs(R, { ...j.template, dates: ['2026-11-05', '2026-11-06'] })
  assert.equal(ids.length, 2)
  const created = hall.deps.db.tables.jobs.filter((x) => ids.includes(x.id))
  assert.deepEqual(created.map((x) => [x.shift_date, x.slots_available, x.duties]), [['2026-11-05', 2, 'Обслуживание зала'], ['2026-11-06', 2, 'Обслуживание зала']])

  // Места: подтвердил 1 — меньше 1 не сделать; свободных = всего − подтвердивших.
  await svc.updateJob(R, J2, { slots: 3, pay: 4000 })
  assert.deepEqual([hall.deps.db.tables.jobs.find((x) => x.id === J2).slots_available, hall.deps.db.tables.jobs.find((x) => x.id === J2).pay_amount], [2, 4000])
  await assert.rejects(() => svc.updateJob(R, J2, { date: '2026-11-09' }), (e) => e.status === 409)
  await assert.rejects(() => svc.deleteJob(R, J2), (e) => e.status === 409)
  await svc.deleteJob(R, ids[0])

  await svc.bookingAction(R, { bookingId: B3, status: 'approved' })
  assert.equal(hall.deps.db.tables.bookings.find((b) => b.id === B3).status, 'approved')
  await assert.rejects(() => svc.bookingAction(R, { bookingId: B3, status: 'confirmed' }), (e) => e.status === 400)
})

test('фрилансеры: смены, отметка на смене, отзыв после смены и рейтинг', async () => {
  let f = await svc.getFreelancers(R)
  const ivan = f.freelancers.find((x) => x.id === IVAN)
  assert.deepEqual(ivan.shifts.map((s) => [s.date, s.done, s.checkedIn]), [['2026-11-02', false, false], ['2026-10-28', true, true]])
  assert.deepEqual(f.toReview.map((s) => s.bookingId), [B1])

  await assert.rejects(() => svc.saveReview(R, { bookingId: B2, rating: 5 }), (e) => e.status === 409) // смена ещё не прошла
  await svc.saveReview(R, { bookingId: B1, rating: 4, comment: 'Быстрый, вежливый' })
  await svc.saveReview(R, { bookingId: B1, rating: 5, comment: 'Отлично' }) // правка, не второй отзыв
  assert.equal(hall.deps.db.tables.waiter_reviews.length, 1)
  assert.equal(hall.deps.db.tables.waiters.find((w) => w.id === IVAN).rating, 5)
  f = await svc.getFreelancers(R)
  assert.equal(f.toReview.length, 0)
  assert.deepEqual(f.freelancers.find((x) => x.id === IVAN).shifts[1].review, { rating: 5, comment: 'Отлично', at: hall.deps.db.tables.waiter_reviews[0].created_at })
})

test('график: неделя, смена сотрудника, фрилансеры по заявкам, копия недели', async () => {
  await svc.setShift(R, { waiterId: ANNA, date: '2026-10-27', startTime: '10:00', endTime: '22:00' })
  await svc.setShift(R, { waiterId: ANNA, date: '2026-10-27', startTime: '12:00', endTime: '23:00', note: 'банкет' })
  await assert.rejects(() => svc.setShift(R, { waiterId: IVAN, date: '2026-10-27', startTime: '10:00', endTime: '22:00' }), (e) => e.status === 400)
  let s = await svc.getSchedule(R, '2026-10-29')
  assert.equal(s.days[0], '2026-10-26')
  assert.deepEqual(s.shifts.map((x) => [x.date, x.startTime, x.endTime, x.note]), [['2026-10-27', '12:00', '23:00', 'банкет']])
  assert.deepEqual(s.freelance.map((x) => [x.waiter.name, x.date]), [['Козлов Иван', '2026-10-28']])

  const { copied } = await svc.copyWeek(R, { from: '2026-10-26', to: '2026-11-04' })
  assert.equal(copied, 1)
  s = await svc.getSchedule(R, '2026-11-02')
  assert.deepEqual(s.shifts.map((x) => x.date), ['2026-11-03'])
  assert.deepEqual(s.freelance.map((x) => x.date), ['2026-11-02'])
  await svc.deleteShift(R, s.shifts[0].id)
  assert.equal((await svc.getSchedule(R, '2026-11-02')).shifts.length, 0)
})
