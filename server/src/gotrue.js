// Работа с GoTrue (Supabase Auth) Admin API.
//
// Используем service_role-ключ — у него все права в /auth/v1/admin/*.
// Все вызовы идут через внешний URL (https://supabase.insis.pro/auth/v1/...),
// потому что waiter-api живёт на хосте, а GoTrue — в docker-сети.

import crypto from 'node:crypto'
import { config } from './config.js'
import { supabaseAdmin } from './supabase.js'

const adminUrl = (path) => `${config.supabaseUrl.replace(/\/$/, '')}/auth/v1/admin${path}`

const adminHeaders = () => ({
  apikey: config.serviceKey,
  Authorization: `Bearer ${config.serviceKey}`,
  'Content-Type': 'application/json',
})

// Нормализация телефона: убираем всё кроме цифр и плюса.
export function normalizePhone(input) {
  if (!input) return ''
  const cleaned = String(input).replace(/[^\d+]/g, '')
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`
}

// Найти auth-пользователя по телефону. Возвращает { id, phone } или null.
async function findUserByPhone(phone) {
  // Admin endpoint /admin/users поддерживает фильтр в виде query — пагинация.
  // На небольших объёмах перебираем первые страницы.
  const url = new URL(adminUrl('/users'))
  url.searchParams.set('page', '1')
  url.searchParams.set('per_page', '200')

  const res = await fetch(url, { headers: adminHeaders() })
  if (!res.ok) return null
  const data = await res.json()
  const user = (data?.users ?? []).find((u) => u.phone === phone.replace(/^\+/, '') || u.phone === phone)
  return user ?? null
}

// Создать auth-пользователя по телефону (без пароля). phone_confirm: true
// помечает телефон как подтверждённый — мы только что проверили SMS-код.
async function createUserByPhone(phone) {
  const res = await fetch(adminUrl('/users'), {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ phone, phone_confirm: true }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(`GoTrue createUser ${res.status}: ${data?.msg ?? data?.error ?? res.statusText}`)
  }
  return await res.json()
}

// Идемпотентно: вернёт существующего пользователя или создаст нового.
export async function getOrCreateAuthUserByPhone(phone) {
  const existing = await findUserByPhone(phone)
  if (existing?.id) return existing
  return await createUserByPhone(phone)
}

// Привязать строку в public.waiters к auth.users.
// Подставляет auth_user_id, ставит phone_verified=true,
// чистит pin_code/pin_expires_at (на всякий случай).
export async function linkWaiterToAuthUser({ phone, authUserId }) {
  // 1. Ищем строку в waiters по телефону
  const { data: waiter, error: findErr } = await supabaseAdmin
    .from('waiters')
    .select('id, auth_user_id')
    .eq('phone', phone)
    .maybeSingle()

  if (findErr) throw findErr

  if (waiter?.id) {
    // Уже есть запись — обновляем
    const { error: updErr } = await supabaseAdmin
      .from('waiters')
      .update({
        auth_user_id: authUserId,
        phone_verified: true,
        pin_code: null,
        pin_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', waiter.id)
    if (updErr) throw updErr
    return waiter.id
  }

  // Записи в waiters нет (первая регистрация): создаём минимальную.
  // first_name по схеме NOT NULL — ставим заглушку, фронт обновит на странице профиля.
  const { data: created, error: insErr } = await supabaseAdmin
    .from('waiters')
    .insert({
      phone,
      first_name: '',
      employment_type: 'freelance',
      phone_verified: true,
      auth_user_id: authUserId,
    })
    .select('id')
    .single()
  if (insErr) throw insErr
  return created.id
}

// Записать refresh_token в auth.refresh_tokens напрямую через service-key.
// supabase-js обменяет этот токен на новый access_token через GoTrue.
export async function persistRefreshToken({ userId, refreshToken }) {
  // Сессия в GoTrue должна существовать — создаём.
  // Структура таблиц auth.sessions / auth.refresh_tokens стабильна в GoTrue v2.
  const sessionId = crypto.randomUUID()

  const { error: sessErr } = await supabaseAdmin
    .schema('auth')
    .from('sessions')
    .insert({ id: sessionId, user_id: userId })
  if (sessErr) throw new Error(`auth.sessions insert: ${sessErr.message}`)

  const { error: rtErr } = await supabaseAdmin
    .schema('auth')
    .from('refresh_tokens')
    .insert({
      token: refreshToken,
      user_id: userId,
      session_id: sessionId,
      revoked: false,
    })
  if (rtErr) throw new Error(`auth.refresh_tokens insert: ${rtErr.message}`)

  return sessionId
}
