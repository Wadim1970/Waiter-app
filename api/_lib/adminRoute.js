import { cors, bodyOf, isAdmin, isUuid } from './http.js'

// Обёртка для функций админки: CORS, restaurantId, доступ, ошибки.
// handlers — { GET: ({ query, body, restaurantId }) => result, POST: …, … }.
// Ошибка с полем status (400/404/409) уходит админке текстом как есть,
// остальные — в лог сервера и «ошибка сервера».
export function adminRoute(name, handlers) {
  return async function handler(req, res) {
    if (cors(req, res)) return
    const run = handlers[req.method]
    if (!run) {
      res.status(405).json({ error: 'Метод не поддерживается' })
      return
    }
    const query = req.query || {}
    const body = req.method === 'GET' ? {} : bodyOf(req)
    const restaurantId = String(query.restaurantId || body.restaurantId || '')
    if (!isUuid(restaurantId)) {
      res.status(400).json({ error: 'restaurantId обязателен' })
      return
    }
    if (!isAdmin(req, restaurantId)) {
      res.status(401).json({ error: 'Нет доступа к кабинету этого ресторана' })
      return
    }
    try {
      res.status(200).json(await run({ query, body, restaurantId }))
    } catch (err) {
      if (err?.status) {
        res.status(err.status).json({ error: err.message })
        return
      }
      console.error(`admin/${name} failed:`, err)
      res.status(500).json({ error: 'Ошибка сервера, попробуйте ещё раз' })
    }
  }
}

export function requireUuid(value, what) {
  if (!isUuid(value)) {
    const e = new Error(`${what} обязателен`)
    e.status = 400
    throw e
  }
  return value
}
