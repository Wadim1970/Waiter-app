// Чтение и валидация переменных окружения.
// Если обязательная переменная не задана — сервис не стартует (fail fast).

let hasMissing = false

function required(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`❌ Не задана обязательная переменная окружения: ${name}`)
    hasMissing = true
  }
  return value
}

function optional(name, fallback) {
  return process.env[name] || fallback
}

export const config = {
  port: Number(optional('PORT', '8080')),

  // CORS: список доменов через запятую. Пусто = разрешить всё (только dev).
  corsOrigin: (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // ── Supabase (база официантов) ───────────────────────────────────────────
  supabaseUrl: required('SUPABASE_WAITER_URL'),
  serviceKey: required('SUPABASE_WAITER_SERVICE_KEY'),
  bucket: optional('WAITER_DOCUMENTS_BUCKET', 'waiter-documents'),

  // Главный криптографический секрет Supabase. Им подписаны все JWT.
  // ЛЕЖИТ В ~/supabase/docker/.env под именем JWT_SECRET.
  // Без него мы не можем выпускать токены, которые GoTrue/PostgREST примут.
  jwtSecret: required('SUPABASE_JWT_SECRET'),

  // Срок жизни access_token (секунд). Совпадает с GOTRUE_JWT_EXP.
  jwtAccessTtlSec: Number(optional('JWT_ACCESS_TTL_SEC', '3600')),
  // aud в JWT — Supabase ожидает 'authenticated'
  jwtAud: optional('JWT_AUD', 'authenticated'),
  // iss в JWT — должен совпадать с GoTrue. Обычно <SUPABASE_URL>/auth/v1
  jwtIssuer: optional('JWT_ISSUER', ''), // если пусто — вычислим из supabaseUrl

  // ── OCR распознавание паспорта ──────────────────────────────────────────
  ocrApiUrl: optional('OCR_API_URL', 'https://api.ocr.ads-soft.ru/recognition'),
  ocrToken: required('OCR_TOKEN'),

  // ── n8n: транспорт для SMS (генерирует код waiter-api, n8n шлёт текст) ──
  n8nWebhookUrl: required('N8N_WEBHOOK_URL'),
  n8nWebhookSecret: required('N8N_WEBHOOK_SECRET'),

  // ── SMS-коды (поведение) ────────────────────────────────────────────────
  smsCodeTtlSec: Number(optional('SMS_CODE_TTL_SEC', '300')),       // 5 минут
  smsResendCooldownSec: Number(optional('SMS_RESEND_COOLDOWN_SEC', '60')),
  smsMaxAttempts: Number(optional('SMS_MAX_ATTEMPTS', '5')),
}

// Авто-вычисление iss, если не задано явно
if (!config.jwtIssuer && config.supabaseUrl) {
  config.jwtIssuer = config.supabaseUrl.replace(/\/$/, '') + '/auth/v1'
}

if (hasMissing) {
  console.error('\n⛔ Запуск прерван: заполните server/.env по образцу server/.env.example\n')
  process.exit(1)
}
