// Сектор «Официанты» в админке — чтение и запись (под service_role):
// штатные сотрудники, заявки на смены для фрилансеров (jobs) и отклики
// (bookings), фрилансеры и отзывы ресторана о них (waiter_reviews),
// график смен (staff_schedule). Логика — teamCore.js.

import { deps, selectAll, selectIn, restaurantOf, groupBy, httpError } from './hallService.js'
import { businessDateOf, isDateStr } from './hallCore.js'
import { normalizePhone } from './bookingsCore.js'
import { jobFields, jobView, jobDates, timeOf, weekOf, fullName, avg1 } from './teamCore.js'

const WAITER_COLS = 'id, first_name, last_name, middle_name, display_name, phone, phone_verified, rating, last_login_at'
const ROLES = new Set(['waiter', 'senior_waiter', 'manager'])
const ACTIVE_BOOKING = new Set(['approved', 'confirmed'])

const missingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''))
const NEED_MIGRATION = 'Нужна миграция 20261031010000_zones_staff.sql на сервере базы'

async function todayOf(restaurantId) {
  const restaurant = await restaurantOf(restaurantId)
  return { restaurant, today: businessDateOf(deps.now(), restaurant.timezone) }
}

async function waitersMap(ids) {
  const rows = await selectIn('waiters', WAITER_COLS, 'id', ids)
  return new Map(rows.map((w) => [w.id, w]))
}

const person = (w) => ({
  id: w?.id || null,
  name: fullName(w),
  phone: w?.phone || null,
  verified: !!w?.phone_verified,
  rating: w?.rating != null ? Number(w.rating) : null,
})

// ── Штатные ──────────────────────────────────────────────────

export async function getTeam(restaurantId) {
  const { restaurant } = await todayOf(restaurantId)
  const rows = await selectAll(() => deps.db.from('restaurant_staff')
    .select('id, waiter_id, role, hire_date, dismissal_date').eq('restaurant_id', restaurantId).order('hire_date'))
  const waiters = await waitersMap(rows.map((r) => r.waiter_id))
  const view = (r) => {
    const w = waiters.get(r.waiter_id)
    return {
      id: r.id, waiterId: r.waiter_id, role: r.role, hireDate: r.hire_date, dismissalDate: r.dismissal_date,
      lastName: w?.last_name || '', firstName: w?.first_name || '', middleName: w?.middle_name || '',
      ...person(w), registered: !!w?.last_login_at || !!w?.phone_verified,
    }
  }
  const all = rows.map(view).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return { restaurant, staff: all.filter((s) => !s.dismissalDate), dismissed: all.filter((s) => s.dismissalDate) }
}

function names(b) {
  const out = {}
  for (const [k, col] of [['lastName', 'last_name'], ['firstName', 'first_name'], ['middleName', 'middle_name']]) {
    if (b[k] !== undefined) out[col] = String(b[k] || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  }
  return out
}

function mobile(raw) {
  const phone = normalizePhone(raw)
  if (!phone || !/^\+7\d{10}$/.test(phone)) throw httpError(400, 'Телефон — российский мобильный: +7 900 000-00-00')
  return phone
}

// Добавить в штат по телефону: официант уже есть в приложении — берём его;
// нет — заводим запись, и когда он войдёт в приложение по SMS с этим
// номером, он сразу окажется сотрудником ресторана.
export async function addStaff(restaurantId, body) {
  const { today } = await todayOf(restaurantId)
  const phone = mobile(body.phone)
  const n = names(body)
  if (!n.first_name || !n.last_name) throw httpError(400, 'Укажите фамилию и имя')
  const role = ROLES.has(body.role) ? body.role : 'waiter'

  const { data: found, error } = await deps.db.from('waiters').select(WAITER_COLS).eq('phone', phone).maybeSingle()
  if (error) throw error
  let waiterId = found?.id
  if (found) {
    // Имя, которое официант сам указал в приложении, не перетираем.
    const fill = Object.fromEntries(Object.entries(n).filter(([col]) => !String(found[col] || '').trim()))
    if (Object.keys(fill).length) {
      const { error: upErr } = await deps.db.from('waiters').update(fill).eq('id', found.id)
      if (upErr) throw upErr
    }
  } else {
    const { data, error: insErr } = await deps.db.from('waiters').insert({ phone, phone_verified: false, ...n }).select('id').single()
    if (insErr) throw insErr
    waiterId = data.id
  }

  const { data: rows, error: sErr } = await deps.db.from('restaurant_staff').select('id, dismissal_date')
    .eq('restaurant_id', restaurantId).eq('waiter_id', waiterId)
  if (sErr) throw sErr
  if ((rows || []).some((r) => !r.dismissal_date)) throw httpError(409, 'Этот официант уже в штате')
  const old = (rows || [])[0]
  if (old) {
    const { error: upErr } = await deps.db.from('restaurant_staff').update({ dismissal_date: null, role, hire_date: today }).eq('id', old.id)
    if (upErr) throw upErr
    return { id: old.id, waiterId, existing: !!found }
  }
  const { data, error: insErr } = await deps.db.from('restaurant_staff')
    .insert({ restaurant_id: restaurantId, waiter_id: waiterId, role, hire_date: today }).select('id').single()
  if (insErr) throw insErr
  return { id: data.id, waiterId, existing: !!found }
}

export async function updateStaff(restaurantId, body) {
  const { today } = await todayOf(restaurantId)
  const { data: row, error } = await deps.db.from('restaurant_staff').select('id, waiter_id, hire_date')
    .eq('id', body.id).eq('restaurant_id', restaurantId).maybeSingle()
  if (error) throw error
  if (!row) throw httpError(404, 'Сотрудник не найден')

  const staff = {}
  if (body.role !== undefined) {
    if (!ROLES.has(body.role)) throw httpError(400, 'Неизвестная должность')
    staff.role = body.role
  }
  if (body.dismissed !== undefined) staff.dismissal_date = body.dismissed ? (today < row.hire_date ? row.hire_date : today) : null
  if (Object.keys(staff).length) {
    const { error: e } = await deps.db.from('restaurant_staff').update(staff).eq('id', row.id)
    if (e) throw e
  }

  const w = names(body)
  if (w.first_name === '' || w.last_name === '') throw httpError(400, 'Укажите фамилию и имя')
  if (body.phone !== undefined) {
    const phone = mobile(body.phone)
    const { data: cur } = await deps.db.from('waiters').select('phone, phone_verified').eq('id', row.waiter_id).maybeSingle()
    if (cur && cur.phone !== phone) {
      // По этому номеру официант входит в приложение — подтверждённый не меняем.
      if (cur.phone_verified) throw httpError(409, 'Официант уже вошёл в приложение по этому номеру — номер меняется только в его приложении')
      const { data: taken } = await deps.db.from('waiters').select('id').eq('phone', phone).maybeSingle()
      if (taken) throw httpError(409, 'Этот номер уже у другого официанта')
      w.phone = phone
    }
  }
  if (Object.keys(w).length) {
    const { error: e } = await deps.db.from('waiters').update(w).eq('id', row.waiter_id)
    if (e) throw e
  }
  return { ok: true }
}

// ── Заявки на смены (jobs) и отклики (bookings) ──────────────

const JOB_COLS = 'id, restaurant_id, shift_date, start_time, end_time, slots_total, slots_available, pay_amount, dress_code, tips_distribution, nutrition, required_documents, responsibility_zone, duties, required_technologies, created_at'

async function jobOf(restaurantId, id) {
  const { data, error } = await deps.db.from('jobs').select(JOB_COLS).eq('id', id).eq('restaurant_id', restaurantId).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Заявка не найдена')
  return data
}

// Заявки: предстоящие и за последние 60 дней, с откликами официантов.
export async function getJobs(restaurantId) {
  const { restaurant, today } = await todayOf(restaurantId)
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86400_000).toISOString().slice(0, 10)
  const jobs = await selectAll(() => deps.db.from('jobs').select(JOB_COLS).eq('restaurant_id', restaurantId)
    .gte('shift_date', since).order('shift_date').order('start_time'))
  const bookings = await selectIn('bookings', 'id, job_id, worker_id, status, created_at', 'job_id', jobs.map((j) => j.id))
  const waiters = await waitersMap(bookings.map((b) => b.worker_id))
  const byJob = groupBy(bookings.filter((b) => b.status !== 'cancelled'), 'job_id')
  const view = (j) => jobView(j, (byJob.get(j.id) || [])
    .map((b) => ({ id: b.id, status: b.status, createdAt: b.created_at, waiter: person(waiters.get(b.worker_id)) }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))))
  const all = jobs.map(view)
  // Последняя заявка — образец для новой: условия те же, меняется дата.
  const last = [...jobs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  return {
    restaurant,
    today,
    upcoming: all.filter((j) => j.date >= today),
    past: all.filter((j) => j.date < today).reverse(),
    template: last ? { ...jobView(last), id: null, date: null, bookings: [] } : null,
  }
}

// Разместить заявку на одну или несколько дат (повтор — те же условия,
// новые даты).
export async function createJobs(restaurantId, body) {
  const { today } = await todayOf(restaurantId)
  const fields = jobFields(body)
  const dates = jobDates(body.dates ?? body.date, today)
  const rows = dates.map((d) => ({ restaurant_id: restaurantId, shift_date: d, ...fields, slots_available: fields.slots_total }))
  const { data, error } = await deps.db.from('jobs').insert(rows).select('id')
  if (error) throw error
  return { ids: (data || []).map((r) => r.id) }
}

export async function updateJob(restaurantId, id, body) {
  const job = await jobOf(restaurantId, id)
  const fields = jobFields(body, { partial: true })
  const bookings = await selectAll(() => deps.db.from('bookings').select('id, status').eq('job_id', id))
  const taken = bookings.filter((b) => b.status === 'confirmed').length
  if (body.date !== undefined && body.date !== job.shift_date) {
    if (!isDateStr(body.date)) throw httpError(400, 'Дата — в виде ГГГГ-ММ-ДД')
    if (bookings.some((b) => ACTIVE_BOOKING.has(b.status))) throw httpError(409, 'На эту смену уже одобрены официанты — дату не поменять. Разместите новую заявку')
    fields.shift_date = body.date
  }
  if (fields.slots_total !== undefined) {
    if (fields.slots_total < taken) throw httpError(409, `Уже подтвердили выход ${taken} — меньше мест не сделать`)
    fields.slots_available = fields.slots_total - taken
  }
  const { error } = await deps.db.from('jobs').update(fields).eq('id', id).eq('restaurant_id', restaurantId)
  if (error) throw error
  return { ok: true }
}

export async function deleteJob(restaurantId, id) {
  await jobOf(restaurantId, id)
  const { data, error } = await deps.db.from('bookings').select('id, status').eq('job_id', id)
  if (error) throw error
  if ((data || []).some((b) => ACTIVE_BOOKING.has(b.status))) throw httpError(409, 'На смену уже одобрены официанты — сначала отмените их')
  const { error: delErr } = await deps.db.from('jobs').delete().eq('id', id).eq('restaurant_id', restaurantId)
  if (delErr) throw delErr
  return { ok: true }
}

// Отклик официанта: одобрить (он подтверждает выход в приложении),
// отклонить, отменить уже одобренного.
export async function bookingAction(restaurantId, body) {
  const status = body.status
  if (!['approved', 'rejected', 'cancelled'].includes(status)) throw httpError(400, 'Неизвестное действие')
  const { data: b, error } = await deps.db.from('bookings').select('id, job_id, status').eq('id', body.bookingId).maybeSingle()
  if (error) throw error
  if (!b) throw httpError(404, 'Отклик не найден')
  await jobOf(restaurantId, b.job_id)
  const { error: upErr } = await deps.db.from('bookings').update({ status, updated_at: deps.now().toISOString() }).eq('id', b.id)
  // Проверки базы (сотрудник ресторана, пересечение смен) — текстом как есть.
  if (upErr?.code === '23514' || upErr?.code === 'P0001') throw httpError(409, upErr.message)
  if (upErr) throw upErr
  return { ok: true }
}

// ── Фрилансеры и отзывы о них ────────────────────────────────

async function reviewsByBooking(bookingIds) {
  if (!bookingIds.length) return { map: new Map(), enabled: true }
  const { data, error } = await deps.db.from('waiter_reviews').select('id, booking_id, rating, comment, created_at').in('booking_id', bookingIds)
  if (missingTable(error)) return { map: new Map(), enabled: false }
  if (error) throw error
  return { map: new Map((data || []).map((r) => [r.booking_id, r])), enabled: true }
}

// Фрилансеры, которые работали (или выйдут) в ресторане по заявкам: их
// смены, отметились ли на смене, наша оценка; смены без отзыва — отдельно.
export async function getFreelancers(restaurantId) {
  const { restaurant, today } = await todayOf(restaurantId)
  const jobs = await selectAll(() => deps.db.from('jobs').select('id, shift_date, start_time, end_time').eq('restaurant_id', restaurantId))
  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const bookings = (await selectIn('bookings', 'id, job_id, worker_id, status', 'job_id', jobs.map((j) => j.id)))
    .filter((b) => ACTIVE_BOOKING.has(b.status))
  const [waiters, shifts, reviews] = await Promise.all([
    waitersMap(bookings.map((b) => b.worker_id)),
    selectIn('staff_shifts', 'waiter_id, job_id, checked_in_at, checked_out_at', 'job_id', bookings.map((b) => b.job_id)),
    reviewsByBooking(bookings.map((b) => b.id)),
  ])
  const checked = new Set(shifts.filter((s) => s.checked_in_at).map((s) => `${s.waiter_id}|${s.job_id}`))

  const byWaiter = new Map()
  for (const b of bookings) {
    const j = jobById.get(b.job_id)
    const r = reviews.map.get(b.id)
    const shift = {
      bookingId: b.id,
      date: j.shift_date,
      startTime: String(j.start_time).slice(0, 5),
      endTime: String(j.end_time).slice(0, 5),
      status: b.status,
      done: j.shift_date <= today,
      checkedIn: checked.has(`${b.worker_id}|${b.job_id}`),
      review: r ? { rating: r.rating, comment: r.comment || '', at: r.created_at } : null,
    }
    if (!byWaiter.has(b.worker_id)) byWaiter.set(b.worker_id, [])
    byWaiter.get(b.worker_id).push(shift)
  }
  const freelancers = [...byWaiter.entries()].map(([id, list]) => {
    list.sort((a, b) => b.date.localeCompare(a.date))
    const mine = list.filter((s) => s.review).map((s) => s.review.rating)
    return {
      ...person(waiters.get(id)),
      shiftsDone: list.filter((s) => s.done).length,
      upcoming: list.filter((s) => !s.done).length,
      lastDate: list.find((s) => s.done)?.date || null,
      myRating: avg1(mine),
      shifts: list,
    }
  }).sort((a, b) => String(b.lastDate || '').localeCompare(String(a.lastDate || '')) || a.name.localeCompare(b.name, 'ru'))

  return {
    restaurant,
    today,
    reviewsEnabled: reviews.enabled,
    freelancers,
    toReview: freelancers.flatMap((f) => f.shifts.filter((s) => s.done && !s.review).map((s) => ({ ...s, waiter: { id: f.id, name: f.name } })))
      .sort((a, b) => b.date.localeCompare(a.date)),
  }
}

// Оценка и отзыв ресторана о смене фрилансера. Официант увидит их в
// приложении (Мои смены → Прошедшие); средняя оценка — в его рейтинге.
export async function saveReview(restaurantId, body) {
  const { today } = await todayOf(restaurantId)
  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw httpError(400, 'Поставьте оценку от 1 до 5')
  const comment = String(body.comment || '').trim().slice(0, 1000) || null
  const { data: b, error } = await deps.db.from('bookings').select('id, job_id, worker_id, status').eq('id', body.bookingId).maybeSingle()
  if (error) throw error
  if (!b) throw httpError(404, 'Смена не найдена')
  const job = await jobOf(restaurantId, b.job_id)
  if (!ACTIVE_BOOKING.has(b.status)) throw httpError(409, 'Официант не выходил на эту смену')
  if (job.shift_date > today) throw httpError(409, 'Оценить можно после смены')

  const { data: cur, error: cErr } = await deps.db.from('waiter_reviews').select('id').eq('booking_id', b.id).maybeSingle()
  if (missingTable(cErr)) throw httpError(409, NEED_MIGRATION)
  if (cErr) throw cErr
  const now = deps.now().toISOString()
  const row = { rating, comment, updated_at: now }
  const { error: wErr } = cur
    ? await deps.db.from('waiter_reviews').update(row).eq('id', cur.id)
    : await deps.db.from('waiter_reviews').insert({ ...row, restaurant_id: restaurantId, waiter_id: b.worker_id, booking_id: b.id, shift_date: job.shift_date })
  if (wErr) throw wErr

  // Рейтинг официанта — средняя оценка ресторанов по всем его сменам.
  const { data: all } = await deps.db.from('waiter_reviews').select('rating').eq('waiter_id', b.worker_id)
  const avg = (all || []).length ? (all.reduce((s, r) => s + r.rating, 0) / all.length) : null
  if (avg != null) await deps.db.from('waiters').update({ rating: Math.round(avg * 100) / 100 }).eq('id', b.worker_id)
  return { ok: true }
}

// ── График смен ──────────────────────────────────────────────

export async function getSchedule(restaurantId, dateStr) {
  const { restaurant, today } = await todayOf(restaurantId)
  const days = weekOf(isDateStr(dateStr) ? dateStr : today)
  const from = days[0]
  const to = days[6]

  const staffRows = await selectAll(() => deps.db.from('restaurant_staff').select('waiter_id, role, hire_date, dismissal_date').eq('restaurant_id', restaurantId))
  // В штате хотя бы один день недели.
  const staff = staffRows.filter((s) => (s.hire_date || '0000') <= to && (!s.dismissal_date || s.dismissal_date >= from))

  const { data: entries, error } = await deps.db.from('staff_schedule').select('id, waiter_id, work_date, start_time, end_time, note')
    .eq('restaurant_id', restaurantId).gte('work_date', from).lte('work_date', to)
  const enabled = !missingTable(error)
  if (error && enabled) throw error

  // Фрилансеры этой недели — по одобренным откликам на заявки.
  const jobs = await selectAll(() => deps.db.from('jobs').select('id, shift_date, start_time, end_time')
    .eq('restaurant_id', restaurantId).gte('shift_date', from).lte('shift_date', to))
  const bookings = (await selectIn('bookings', 'id, job_id, worker_id, status', 'job_id', jobs.map((j) => j.id))).filter((b) => ACTIVE_BOOKING.has(b.status))
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  const waiters = await waitersMap([...staff.map((s) => s.waiter_id), ...bookings.map((b) => b.worker_id)])
  const t = (v) => String(v).slice(0, 5)
  return {
    restaurant,
    today,
    days,
    enabled,
    staff: staff.map((s) => ({ ...person(waiters.get(s.waiter_id)), role: s.role })).sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    shifts: (enabled ? entries || [] : []).map((e) => ({ id: e.id, waiterId: e.waiter_id, date: e.work_date, startTime: t(e.start_time), endTime: t(e.end_time), note: e.note || '' })),
    freelance: bookings.map((b) => {
      const j = jobById.get(b.job_id)
      return { bookingId: b.id, waiter: person(waiters.get(b.worker_id)), date: j.shift_date, startTime: t(j.start_time), endTime: t(j.end_time), status: b.status }
    }).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)),
  }
}

async function assertStaff(restaurantId, waiterId) {
  const { data, error } = await deps.db.from('restaurant_staff').select('id').eq('restaurant_id', restaurantId).eq('waiter_id', waiterId).is('dismissal_date', null)
  if (error) throw error
  if (!data?.length) throw httpError(400, 'Это не сотрудник ресторана')
}

// Поставить (или изменить) смену сотрудника на день.
export async function setShift(restaurantId, body) {
  if (!isDateStr(body.date)) throw httpError(400, 'Дата — в виде ГГГГ-ММ-ДД')
  const start = timeOf(body.startTime, 'Начало')
  const end = timeOf(body.endTime, 'Конец')
  if (start === end) throw httpError(400, 'Начало и конец смены совпадают')
  await assertStaff(restaurantId, body.waiterId)
  const note = String(body.note || '').trim().slice(0, 200) || null
  const { data: cur, error } = await deps.db.from('staff_schedule').select('id')
    .eq('restaurant_id', restaurantId).eq('waiter_id', body.waiterId).eq('work_date', body.date).maybeSingle()
  if (missingTable(error)) throw httpError(409, NEED_MIGRATION)
  if (error) throw error
  const row = { start_time: start, end_time: end, note }
  const { error: wErr } = cur
    ? await deps.db.from('staff_schedule').update(row).eq('id', cur.id)
    : await deps.db.from('staff_schedule').insert({ ...row, restaurant_id: restaurantId, waiter_id: body.waiterId, work_date: body.date })
  if (wErr) throw wErr
  return { ok: true }
}

export async function deleteShift(restaurantId, id) {
  const { error } = await deps.db.from('staff_schedule').delete().eq('id', id).eq('restaurant_id', restaurantId)
  if (missingTable(error)) throw httpError(409, NEED_MIGRATION)
  if (error) throw error
  return { ok: true }
}

// Скопировать график недели на другую неделю (дни, где смена уже стоит,
// не трогаем; уволенных не переносим).
export async function copyWeek(restaurantId, body) {
  if (!isDateStr(body.from) || !isDateStr(body.to)) throw httpError(400, 'Укажите недели')
  const src = weekOf(body.from)
  const dst = weekOf(body.to)
  if (src[0] === dst[0]) throw httpError(400, 'Это та же неделя')
  const { data: entries, error } = await deps.db.from('staff_schedule').select('waiter_id, work_date, start_time, end_time, note')
    .eq('restaurant_id', restaurantId).gte('work_date', src[0]).lte('work_date', src[6])
  if (missingTable(error)) throw httpError(409, NEED_MIGRATION)
  if (error) throw error
  const { data: existing } = await deps.db.from('staff_schedule').select('waiter_id, work_date')
    .eq('restaurant_id', restaurantId).gte('work_date', dst[0]).lte('work_date', dst[6])
  const busy = new Set((existing || []).map((e) => `${e.waiter_id}|${e.work_date}`))
  const active = new Set((await selectAll(() => deps.db.from('restaurant_staff').select('waiter_id').eq('restaurant_id', restaurantId).is('dismissal_date', null))).map((s) => s.waiter_id))
  const rows = (entries || [])
    .map((e) => ({ ...e, work_date: dst[src.indexOf(e.work_date)], restaurant_id: restaurantId }))
    .filter((e) => active.has(e.waiter_id) && !busy.has(`${e.waiter_id}|${e.work_date}`))
  if (rows.length) {
    const { error: insErr } = await deps.db.from('staff_schedule').insert(rows)
    if (insErr) throw insErr
  }
  return { copied: rows.length }
}
