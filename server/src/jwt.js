// Подпись Supabase-совместимого JWT.
//
// Когда официант успешно ввёл SMS-код, нам нужно вернуть фронту пару
// (access_token, refresh_token), чтобы supabase-js считал его залогиненным.
//
// access_token — стандартный JWT с claim'ами, которые ждёт PostgREST/GoTrue:
//   sub   — auth.users.id (UUID), его потом увидит auth.uid() в RLS
//   aud   — 'authenticated' (значение GOTRUE_JWT_AUD)
//   role  — 'authenticated' (PostgREST переключит роль БД на эту)
//   iss   — '<supabase_url>/auth/v1'
//   exp/iat — срок жизни
//   phone — нужен ряду RLS-политик
//
// refresh_token — мы не подделываем токен Supabase, а создаём свой случайный
// и пишем его в auth.refresh_tokens напрямую. supabase-js потом обменяет его
// на новый access_token через GoTrue — тот сам найдёт запись в БД.
//
// ВАЖНО: подпись делается тем же SUPABASE_JWT_SECRET, что и в GoTrue/PostgREST.
// Если секрет не совпадёт — токен будет отклонён с 401.

import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { config } from './config.js'

export function signAccessToken({ userId, phone }) {
  const nowSec = Math.floor(Date.now() / 1000)
  const payload = {
    sub: userId,
    aud: config.jwtAud,
    role: 'authenticated',
    iss: config.jwtIssuer,
    iat: nowSec,
    exp: nowSec + config.jwtAccessTtlSec,
    phone: phone ?? '',
    app_metadata: { provider: 'phone', providers: ['phone'] },
    user_metadata: {},
  }
  return jwt.sign(payload, config.jwtSecret, { algorithm: 'HS256' })
}

// Случайная строка для refresh_token. 32 байта = 256 бит энтропии.
export function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url')
}
