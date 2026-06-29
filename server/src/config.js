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

  supabaseUrl: required('SUPABASE_WAITER_URL'),
  serviceKey: required('SUPABASE_WAITER_SERVICE_KEY'),
  bucket: optional('WAITER_DOCUMENTS_BUCKET', 'waiter-documents'),

  ocrApiUrl: optional('OCR_API_URL', 'https://api.ocr.ads-soft.ru/recognition'),
  ocrToken: required('OCR_TOKEN'),

  n8nWebhookUrl: required('N8N_WEBHOOK_URL'),
  n8nWebhookSecret: required('N8N_WEBHOOK_SECRET'),
}

if (hasMissing) {
  console.error('\n⛔ Запуск прерван: заполните server/.env по образцу server/.env.example\n')
  process.exit(1)
}
