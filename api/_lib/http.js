// Общие мелочи для функций, которые зовут ДРУГИЕ сайты (гостевое приложение,
// админка): CORS, разбор тела, проверка токена админки.

import crypto from 'node:crypto'

// Возвращает true, если это был preflight (OPTIONS) и ответ уже отправлен.
export function cors(req, res, methods = 'GET, POST, PATCH, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token')
  res.setHeader('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return true
  }
  return false
}

export function bodyOf(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body) } catch { return {} }
  }
  return req.body || {}
}

// Учебный ресторан «Сыроварня» — его кабинет открыт без входа, пока нет
// входа в личный кабинет ресторана. Список меняется в окружении сервера
// (ADMIN_OPEN_RESTAURANTS, через запятую; пустая строка — закрыть все).
const DEMO_RESTAURANT_ID = 'dd89773c-0952-4fd1-9510-514094a928ee'
function openRestaurants() {
  const raw = process.env.ADMIN_OPEN_RESTAURANTS ?? DEMO_RESTAURANT_ID
  return new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
}

// Доступ к функциям админки: кабинет открытого ресторана — без токена;
// любой другой ресторан и действия по всем ресторанам (cron) — только с
// токеном ADMIN_TOKEN (или прежним PAIRINGS_ADMIN_TOKEN) в X-Admin-Token.
export function isAdmin(req, restaurantId = '') {
  if (restaurantId && openRestaurants().has(String(restaurantId).toLowerCase())) return true
  const expected = process.env.ADMIN_TOKEN || process.env.PAIRINGS_ADMIN_TOKEN || ''
  const got = String(req.headers['x-admin-token'] || '')
  if (!expected || got.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s) => UUID_RE.test(String(s || ''))
