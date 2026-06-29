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

// Отправка SMS-кода через бэкенд (секрет вебхука хранится на сервере).
export async function sendSmsCode(payload: {
  waiterId: string
  phone: string
  name: string
}): Promise<void> {
  const res = await fetch(apiUrl('/api/send-sms'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Ошибка отправки SMS')
  }
}
