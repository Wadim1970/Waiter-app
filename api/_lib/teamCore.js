// Сектор «Официанты» в админке — ЧИСТАЯ логика: поля заявки на смену
// (как в карточке смены приложения официанта), недели графика, имена.

import { addDays, isDateStr } from './hallCore.js'

function bad(message) {
  const e = new Error(message)
  e.status = 400
  return e
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const text = (v, max) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export function timeOf(v, what) {
  const s = String(v || '').slice(0, 5)
  if (!TIME_RE.test(s)) throw bad(`${what}: время в виде ЧЧ:ММ`)
  return s
}

// Условия смены — те же поля, что видит официант в карточке смены.
export const JOB_TEXT_FIELDS = {
  dressCode: 'dress_code',
  tipsDistribution: 'tips_distribution',
  nutrition: 'nutrition',
  requiredDocuments: 'required_documents',
  responsibilityZone: 'responsibility_zone',
  duties: 'duties',
  requiredTechnologies: 'required_technologies',
}

export function jobFields(b, { partial = false } = {}) {
  const out = {}
  if (!partial || b.startTime !== undefined) out.start_time = timeOf(b.startTime, 'Начало смены')
  if (!partial || b.endTime !== undefined) out.end_time = timeOf(b.endTime, 'Конец смены')
  if (!partial || b.slots !== undefined) {
    const n = Number(b.slots)
    if (!Number.isInteger(n) || n < 1 || n > 50) throw bad('Сколько официантов нужно — от 1 до 50')
    out.slots_total = n
  }
  if (!partial || b.pay !== undefined) {
    const p = Number(b.pay)
    if (!Number.isFinite(p) || p < 0 || p > 1_000_000) throw bad('Укажите оплату за смену')
    out.pay_amount = Math.round(p)
  }
  for (const [k, col] of Object.entries(JOB_TEXT_FIELDS)) {
    if (!partial || b[k] !== undefined) out[col] = text(b[k], 1000)
  }
  return out
}

export function jobView(j, bookings = []) {
  return {
    id: j.id,
    date: j.shift_date,
    startTime: String(j.start_time || '').slice(0, 5),
    endTime: String(j.end_time || '').slice(0, 5),
    slots: j.slots_total,
    slotsFree: j.slots_available ?? j.slots_total,
    pay: Number(j.pay_amount || 0),
    ...Object.fromEntries(Object.entries(JOB_TEXT_FIELDS).map(([k, col]) => [k, j[col] || ''])),
    createdAt: j.created_at,
    bookings,
  }
}

// Даты для «разместить ещё раз»: список дат, без повторов и прошлого.
export function jobDates(dates, today) {
  const list = [...new Set((Array.isArray(dates) ? dates : [dates]).map(String))].filter(Boolean)
  if (!list.length) throw bad('Выберите дату смены')
  if (list.length > 31) throw bad('Не больше 31 даты за раз')
  for (const d of list) {
    if (!isDateStr(d)) throw bad('Дата — в виде ГГГГ-ММ-ДД')
    if (d < today) throw bad('Дата смены уже прошла')
  }
  return list.sort()
}

// Неделя графика: понедельник выбранной даты и 7 дней.
export function weekOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const shift = (d.getUTCDay() + 6) % 7
  const monday = addDays(dateStr, -shift)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export const fullName = (w) => [w?.last_name, w?.first_name, w?.middle_name].map((s) => String(s || '').trim()).filter(Boolean).join(' ')
  || String(w?.display_name || '').trim() || 'Без имени'

export const avg1 = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
