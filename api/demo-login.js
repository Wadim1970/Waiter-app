import crypto from 'node:crypto'
import { bodyOf } from './_lib/http.js'
import {
  demoConfig, adminClient, demoPasswordGrant, findDemoWaiterId,
  ensureTableAssignments, ensureTodayShift, resetDemoName,
} from './_lib/demoWaiter.js'

// Вход по коду (кнопка «Вход» на главном экране приложения официанта).
// Пока единственный код — демо-доступ для рестораторов (DEMO_CODE, по
// умолчанию 1111): сессия демо-официанта «Сыроварни», смена на сегодня и
// закреплённые столы. Подробности — api/_lib/demoWaiter.js.
//
// Ответ — как у входа по SMS (access/refresh токены и waiter_id) плюс
// restaurant_id: приложение запоминает его как текущую смену.

// Простая защита от перебора: не больше ATTEMPTS попыток с адреса за окно.
const WINDOW_MS = 10 * 60 * 1000
const ATTEMPTS = 10
const attempts = new Map()

function tooManyAttempts(ip) {
  const now = Date.now()
  const recent = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  recent.push(now)
  attempts.set(ip, recent)
  if (attempts.size > 5000) attempts.clear()
  return recent.length > ATTEMPTS
}

function sameCode(got, expected) {
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' })
    return
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim()
  if (tooManyAttempts(ip)) {
    res.status(429).json({ error: 'Слишком много попыток. Попробуйте через 10 минут.' })
    return
  }

  const cfg = demoConfig()
  const code = String(bodyOf(req).code ?? '').trim()
  if (!/^\d{4}$/.test(code) || !sameCode(code, cfg.code)) {
    res.status(401).json({ error: 'Неверный код' })
    return
  }
  if (!cfg.password || !cfg.supabaseUrl || !cfg.serviceKey) {
    console.error('demo-login: не настроен (DEMO_WAITER_PASSWORD / SUPABASE_URL / SUPABASE_SERVICE_KEY)')
    res.status(503).json({ error: 'Демо-вход не настроен на сервере' })
    return
  }

  let session
  try {
    session = await demoPasswordGrant(cfg)
  } catch (err) {
    console.error('demo-login: вход демо-официанта', err)
    res.status(502).json({ error: 'Не удалось войти. Попробуйте ещё раз.' })
    return
  }

  const db = adminClient(cfg)
  let waiterId
  try {
    waiterId = await findDemoWaiterId(db, session.user.id)
    if (!waiterId) throw new Error('нет строки waiters — запустите scripts/demo-waiter-setup.mjs')
  } catch (err) {
    console.error('demo-login:', err)
    res.status(500).json({ error: 'Демо-официант не настроен' })
    return
  }

  // Подготовка смены — по возможности: если что-то не вышло, вход всё равно
  // пускаем (приложение для демо-официанта не требует смены), но пишем в лог.
  await Promise.all([
    ensureTodayShift(db, cfg, waiterId).catch((e) => console.error('demo-login: смена на сегодня', e)),
    ensureTableAssignments(db, cfg, waiterId).catch((e) => console.error('demo-login: столы', e)),
    resetDemoName(db, cfg, waiterId).catch((e) => console.error('demo-login: имя', e)),
  ])

  res.status(200).json({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: session.token_type ?? 'bearer',
    user: { id: session.user.id, waiter_id: waiterId },
    restaurant_id: cfg.restaurantId,
  })
}
