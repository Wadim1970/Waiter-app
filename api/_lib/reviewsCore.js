// Раздел «Жалобы и оценки» — ЧИСТАЯ логика: что считать жалобой, сводка,
// распределение оценок, разбивка по официантам и дням.

// 0 — гость оценку не ставил (submit_review пишет 0..5).
const given = (v) => (Number(v) > 0 ? Number(v) : null)

// Жалоба — любая поставленная оценка 3 и ниже: на кухню или на сервис.
export const COMPLAINT_MAX = 3

export function classify(r) {
  const food = given(r.rating_food)
  const service = given(r.rating_service)
  const worst = Math.min(food ?? 9, service ?? 9)
  return {
    food,
    service,
    complaint: worst <= COMPLAINT_MAX,
    severity: worst <= 2 ? 'high' : worst === 3 ? 'medium' : null,
    about: [food != null && food <= COMPLAINT_MAX ? 'kitchen' : null, service != null && service <= COMPLAINT_MAX ? 'service' : null].filter(Boolean),
  }
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

function distribution(values) {
  const d = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
  for (const v of values) if (d[v] != null) d[v]++
  return d
}

export function summarize(reviews) {
  const food = reviews.map((r) => r.food).filter((v) => v != null)
  const service = reviews.map((r) => r.service).filter((v) => v != null)
  const complaints = reviews.filter((r) => r.complaint)
  return {
    reviews: reviews.length,
    withComment: reviews.filter((r) => r.comment).length,
    food: { avg: avg(food), count: food.length, distribution: distribution(food) },
    service: { avg: avg(service), count: service.length, distribution: distribution(service) },
    complaints: complaints.length,
    complaintsPct: reviews.length ? Math.round((complaints.length / reviews.length) * 100) : 0,
    unresolved: complaints.filter((r) => !r.resolvedAt).length,
  }
}

// По официантам: сколько отзывов о посадках, средний сервис, жалобы.
export function byWaiter(reviews) {
  const m = new Map()
  for (const r of reviews) {
    if (!r.waiter?.id) continue
    const w = m.get(r.waiter.id) || { id: r.waiter.id, name: r.waiter.name, reviews: 0, service: [], complaints: 0 }
    w.reviews++
    if (r.service != null) w.service.push(r.service)
    if (r.complaint) w.complaints++
    m.set(r.waiter.id, w)
  }
  return [...m.values()]
    .map(({ service, ...w }) => ({ ...w, serviceAvg: avg(service) }))
    .sort((a, b) => b.complaints - a.complaints || (a.serviceAvg ?? 9) - (b.serviceAvg ?? 9))
}

export function byDay(reviews, dates) {
  const m = new Map(dates.map((d) => [d, []]))
  for (const r of reviews) m.get(r.date)?.push(r)
  return dates.map((date) => {
    const list = m.get(date)
    const food = list.map((r) => r.food).filter((v) => v != null)
    const service = list.map((r) => r.service).filter((v) => v != null)
    return {
      date,
      reviews: list.length,
      complaints: list.filter((r) => r.complaint).length,
      foodAvg: avg(food),
      foodCount: food.length,
      serviceAvg: avg(service),
      serviceCount: service.length,
    }
  })
}
