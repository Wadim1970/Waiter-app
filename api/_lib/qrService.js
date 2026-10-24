// QR допуска к смене: суточный токен ресторана (restaurant_daily_tokens) и
// его картинка. Токен создаёт ночной планировщик базы (generate_daily_tokens);
// здесь — показать сегодняшний, сбросить вручную и отдать картинку,
// в том числе по ссылке с подписью (чтобы переслать в мессенджер или почтой).

import crypto from 'node:crypto'
import QRCode from 'qrcode'
import { supabase } from './suggestService.js'

export const deps = {
  db: supabase,
  now: () => new Date(),
  newToken: () => crypto.randomBytes(16).toString('hex'),
}

const HISTORY_DAYS = 15
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const isDateStr = (s) => DATE_RE.test(String(s || ''))

function httpError(status, message) {
  const e = new Error(message)
  e.status = status
  return e
}

// «Сегодня» — по UTC, как у сканера официанта (QRScannerScreen: valid_date = сегодня UTC).
export const todayOf = () => deps.now().toISOString().slice(0, 10)

// ── Подпись ссылки на картинку ──
// Ключ — токен администратора из окружения сервера; нового секрета не заводим.
function signKey() {
  return process.env.ADMIN_TOKEN || process.env.PAIRINGS_ADMIN_TOKEN || ''
}

export function signLink(restaurantId, date) {
  const key = signKey()
  if (!key) return null
  return crypto.createHmac('sha256', key).update(`qr:${restaurantId}:${date}`).digest('hex').slice(0, 32)
}

export function verifyLink(restaurantId, date, sig) {
  const expected = signLink(restaurantId, date)
  const got = String(sig || '')
  if (!expected || got.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}

function shareUrl(base, restaurantId, date) {
  const sig = signLink(restaurantId, date)
  if (!base || !sig) return null
  return `${base.replace(/\/$/, '')}/api/qr-image?r=${restaurantId}&d=${date}&s=${sig}`
}

async function loadRestaurant(restaurantId) {
  const { data, error } = await deps.db.from('restaurants')
    .select('id, name, timezone, qr_reset_time')
    .eq('id', restaurantId).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Ресторан не найден')
  return data
}

// Страница «QR-коды»: сегодняшний токен, ссылка для пересылки и история дней.
// Старые токены не отдаём — они уже недействительны, а в истории нужны только даты.
export async function getQr(restaurantId, { base = '' } = {}) {
  const restaurant = await loadRestaurant(restaurantId)
  const today = todayOf()
  const { data: rows, error } = await deps.db.from('restaurant_daily_tokens')
    .select('token, valid_date, created_at')
    .eq('restaurant_id', restaurantId)
    .order('valid_date', { ascending: false })
    .limit(HISTORY_DAYS)
  if (error) throw error
  const current = (rows || []).find((r) => r.valid_date === today) || null
  return {
    restaurant: {
      id: restaurantId,
      name: restaurant.name,
      timezone: restaurant.timezone || null,
      qrResetTime: restaurant.qr_reset_time ? String(restaurant.qr_reset_time).slice(0, 5) : null,
    },
    today,
    current: current && {
      date: current.valid_date,
      createdAt: current.created_at,
      token: current.token,
      shareUrl: shareUrl(base, restaurantId, current.valid_date),
    },
    history: (rows || []).map((r) => ({ date: r.valid_date, createdAt: r.created_at, active: r.valid_date === today })),
  }
}

// Новый токен на сегодня: прежний сразу перестаёт приниматься сканером.
export async function resetQr(restaurantId, opts = {}) {
  await loadRestaurant(restaurantId)
  const today = todayOf()
  const { error: delErr } = await deps.db.from('restaurant_daily_tokens')
    .delete().eq('restaurant_id', restaurantId).eq('valid_date', today)
  if (delErr) throw delErr
  const { error: insErr } = await deps.db.from('restaurant_daily_tokens')
    .insert({ restaurant_id: restaurantId, token: deps.newToken(), valid_date: today })
  if (insErr) {
    if (insErr.code === '23505') throw httpError(409, 'Токен сейчас обновляется, попробуйте ещё раз')
    throw insErr
  }
  return getQr(restaurantId, opts)
}

// Картинка QR за дату: содержимое — сам токен (сканер принимает и токен, и ссылку с ?token=).
export async function qrImage(restaurantId, date) {
  const { data, error } = await deps.db.from('restaurant_daily_tokens')
    .select('token').eq('restaurant_id', restaurantId).eq('valid_date', date).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'На эту дату QR нет')
  return QRCode.toBuffer(data.token, { type: 'png', width: 720, margin: 2, errorCorrectionLevel: 'M' })
}
