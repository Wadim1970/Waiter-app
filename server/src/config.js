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

  // Токены теперь выпускает сам GoTrue (grant_type=password), поэтому
  // подписывать JWT на нашей стороне не нужно. Переменная больше не
  // обязательна — оставлена опционально на случай будущей проверки токенов.
  jwtSecret: optional('SUPABASE_JWT_SECRET', ''),

  // ── OCR распознавание паспорта ──────────────────────────────────────────
  ocrApiUrl: optional('OCR_API_URL', 'https://api.ocr.ads-soft.ru/recognition'),
  ocrToken: required('OCR_TOKEN'),

  // ── n8n: транспорт для SMS (генерирует код waiter-api, n8n шлёт текст) ──
  n8nWebhookUrl: required('N8N_WEBHOOK_URL'),
  n8nWebhookSecret: required('N8N_WEBHOOK_SECRET'),

  // ── Web Push (вызов официанта — доставка, пока приложение свёрнуто) ────
  // Публичный ключ дублируется во фронте (VITE_VAPID_PUBLIC_KEY) — это
  // не секрет, приватный не должен покидать этот сервис.
  vapidPublicKey: required('VAPID_PUBLIC_KEY'),
  vapidPrivateKey: required('VAPID_PRIVATE_KEY'),
  // Контакт для push-сервисов (Apple/Google) на случай проблем с отправками —
  // формат "mailto:..." или "https://...".
  vapidSubject: required('VAPID_SUBJECT'),

  // ── SMS-коды (поведение) ────────────────────────────────────────────────
  smsCodeTtlSec: Number(optional('SMS_CODE_TTL_SEC', '300')),       // 5 минут
  smsResendCooldownSec: Number(optional('SMS_RESEND_COOLDOWN_SEC', '60')),
  smsMaxAttempts: Number(optional('SMS_MAX_ATTEMPTS', '5')),

  // ── DeepSeek (AI-коуч официанта, текстовые подсказки апсейла) ──────────────
  // Ключ ОПЦИОНАЛЕН: без него /api/waiter/suggest отдаёт шаблонные подсказки
  // (деградация, а не отказ). DeepSeek OpenAI-совместим.
  deepseekApiKey: optional('DEEPSEEK_API_KEY', ''),
  deepseekBaseUrl: optional('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
  deepseekModel: optional('DEEPSEEK_MODEL', 'deepseek-chat'),
}

if (hasMissing) {
  console.error('\n⛔ Запуск прерван: заполните server/.env по образцу server/.env.example\n')
  process.exit(1)
}
