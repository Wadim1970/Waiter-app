// Клиент для бэкенда waiter-api.
// Сюда вынесены операции, которым нужны серверные секреты
// (service-key, OCR-токен, webhook-секрет) — во фронте их быть не должно.

const API_URL = import.meta.env.VITE_API_URL as string | undefined

function apiUrl(path: string): string {
  if (!API_URL) {
    throw new Error('VITE_API_URL не задан — укажите адрес сервиса waiter-api')
  }
  return `${API_URL.replace(/\/$/, '')}${path}`
}

// Загрузка документа официанта (паспорт/медкнижка/личное фото).
// Возвращает публичный URL загруженного файла.
export async function uploadDocument(file: File, waiterId: string, path: string): Promise<string> {
  const form = new FormData()
  form.append('waiterId', waiterId)
  form.append('path', path)
  form.append('file', file)

  const res = await fetch(apiUrl('/api/upload-document'), { method: 'POST', body: form })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Ошибка загрузки файла')
  }
  const data = await res.json()
  return data.url as string
}

export type OcrField = { label: string; text: string }

// Распознавание паспорта. При ошибке возвращает [] — поля заполняются вручную.
export async function recognizePassport(file: File): Promise<OcrField[]> {
  const form = new FormData()
  form.append('file', file)

  const res = await fetch(apiUrl('/api/ocr'), { method: 'POST', body: form })
  if (!res.ok) return []
  const data = await res.json().catch(() => ({ results: [] }))
  return (data.results ?? []) as OcrField[]
}

// Запрос SMS-кода. Бэкенд сам генерирует код, хеширует и шлёт через n8n.
export async function sendSmsCode(phone: string): Promise<void> {
  const res = await fetch(apiUrl('/api/send-sms'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Ошибка отправки SMS')
  }
}

export type VerifySmsResult = {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
  user: { id: string; phone: string; waiter_id: string }
}

// Проверка SMS-кода. При успехе бэкенд возвращает настоящую сессию Supabase
// (access + refresh токены) и waiter_id.
export async function verifySms(phone: string, code: string): Promise<VerifySmsResult> {
  const res = await fetch(apiUrl('/api/verify-sms'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, code }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось подтвердить код')
  }
  return data as VerifySmsResult
}

// ── AI-коуч официанта ──────────────────────────────────────────────────────
export type AiSuggestion = {
  dishId: string
  name: string
  price: number
  pitch: string
  addon: string | null
  badges: string[]
  reason?: string | null
}

export type AiSuggestGuest = { gender?: string | null; age?: string | null; occasion?: string | null; partySize?: number | null; preferences?: string | null }

// Подсказки апсейла для стадии/тега/гостя. exclude — уже показанные dishId
// (для «другой вариант»). Эндпоинт — Vercel serverless-функция, same-origin
// (/api/waiter/suggest), поэтому НЕ через VITE_API_URL. Ключ DeepSeek
// опционален (без него приходят шаблонные подсказки).
export async function getSuggestions(payload: {
  restaurantId: string
  stage?: string
  tag?: string
  guest?: AiSuggestGuest
  exclude?: string[]
  cartItemIds?: string[]
  limit?: number
}): Promise<{ suggestions: AiSuggestion[]; source: string }> {
  const res = await fetch('/api/waiter/suggest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || 'Не удалось получить подсказку')
  }
  return data as { suggestions: AiSuggestion[]; source: string }
}

// Прогрев кэша подсказок при открытии гостя (fire-and-forget). Считает
// подсказки тегов стадии заранее, чтобы первый тап был мгновенным. Ошибки
// не важны — прогрев не критичный путь.
export async function warmSuggestions(payload: {
  restaurantId: string
  stage?: string
  guest?: AiSuggestGuest
  cartItemIds?: string[]
  tags: string[]
  limit?: number
}): Promise<void> {
  try {
    await fetch('/api/waiter/warm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // прогрев не критичен — молча игнорируем
  }
}

// Рекомендательный набор для виджета «Подсказка от RestAI» — один связный текст.
export async function getRecommendation(payload: {
  restaurantId: string
  cartItemIds: string[]
  guest?: AiSuggestGuest
}): Promise<{ text: string | null; source: string }> {
  const res = await fetch('/api/waiter/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Не удалось получить рекомендацию')
  return data as { text: string | null; source: string }
}

// ИИ-полировка реплик «коуча стола»: шлём готовые тексты сигналов + профиль
// гостя, получаем более тёплые произносимые фразы { [signalId]: 'фраза' }.
// Необязательное улучшение — на любой сбой возвращаем null, клиент оставляет
// свой детерминированный текст.
export async function polishCoachSignals(payload: {
  signals: { id: string; text: string; quote: string }[]
  guest?: AiSuggestGuest
}): Promise<Record<string, string> | null> {
  try {
    const res = await fetch('/api/waiter/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    return (data && data.polished) || null
  } catch {
    return null
  }
}
