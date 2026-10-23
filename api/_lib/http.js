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

// Токен админки — ADMIN_TOKEN (или прежний PAIRINGS_ADMIN_TOKEN) в окружении
// сервера. Без него админские функции выключены совсем.
export function isAdmin(req) {
  const expected = process.env.ADMIN_TOKEN || process.env.PAIRINGS_ADMIN_TOKEN || ''
  const got = String(req.headers['x-admin-token'] || '')
  if (!expected || got.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (s) => UUID_RE.test(String(s || ''))
