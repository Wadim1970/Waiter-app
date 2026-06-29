import { config } from './config.js'
import { supabaseAdmin } from './supabase.js'

// Разрешённые типы файлов для документов официанта
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

// Разрешённые префиксы путей в бакете (защита от записи в чужие каталоги)
const ALLOWED_PATH = /^(passport|medical-book|personal_photos)\/[a-zA-Z0-9_\-/]+$/

function randomId() {
  return Math.random().toString(36).slice(2, 9)
}

// Считывает multipart-запрос в { fields, file }
async function readMultipart(req) {
  const fields = {}
  let file = null
  for await (const part of req.parts()) {
    if (part.type === 'file') {
      const buffer = await part.toBuffer()
      file = { buffer, filename: part.filename, mimetype: part.mimetype }
    } else {
      fields[part.fieldname] = part.value
    }
  }
  return { fields, file }
}

export async function routes(app) {
  // Проверка живости
  app.get('/health', async () => ({ ok: true }))

  // ── Загрузка документа официанта в Storage (service-key только здесь) ──
  app.post('/api/upload-document', async (req, reply) => {
    const { fields, file } = await readMultipart(req)
    const waiterId = String(fields.waiterId || '').trim()
    const path = String(fields.path || '').trim()

    if (!waiterId || !file) {
      return reply.code(400).send({ error: 'waiterId и файл обязательны' })
    }
    if (!ALLOWED_PATH.test(path) || path.includes('..')) {
      return reply.code(400).send({ error: 'Недопустимый путь' })
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return reply.code(415).send({ error: 'Недопустимый тип файла' })
    }

    const ext = (file.filename.split('.').pop() || 'bin').toLowerCase()
    const fileName = `${Date.now()}_${randomId()}.${ext}`
    const filePath = `${waiterId}/${path}/${fileName}`

    const { error } = await supabaseAdmin.storage
      .from(config.bucket)
      .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false })

    if (error) {
      req.log.error(error)
      return reply.code(502).send({ error: 'Ошибка загрузки файла' })
    }

    const { data } = supabaseAdmin.storage.from(config.bucket).getPublicUrl(filePath)
    return { url: data.publicUrl }
  })

  // ── Распознавание паспорта (OCR-токен только здесь) ──
  app.post('/api/ocr', async (req, reply) => {
    const { file } = await readMultipart(req)
    if (!file) {
      return reply.code(400).send({ error: 'Файл обязателен' })
    }
    try {
      const form = new FormData()
      form.append('token', config.ocrToken)
      form.append('image', new Blob([file.buffer], { type: file.mimetype }), file.filename)
      form.append('include_b64_image', '0')

      const res = await fetch(config.ocrApiUrl, { method: 'POST', body: form })
      if (!res.ok) return { results: [] }

      const json = await res.json()
      const results = json?.data?.[0]?.data?.results ?? []
      return { results }
    } catch (e) {
      req.log.error(e)
      // Не ломаем регистрацию — пользователь заполнит поля вручную
      return { results: [] }
    }
  })

  // ── Отправка SMS-кода через n8n (webhook-секрет только здесь) ──
  app.post('/api/send-sms', async (req, reply) => {
    const { waiterId, phone, name } = req.body || {}
    if (!waiterId || !phone || !name) {
      return reply.code(400).send({ error: 'waiterId, phone и name обязательны' })
    }
    if (!/^\+7\d{10}$/.test(String(phone))) {
      return reply.code(400).send({ error: 'Неверный формат телефона' })
    }
    try {
      const res = await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': config.n8nWebhookSecret,
        },
        body: JSON.stringify({ waiterId, phone, name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return reply.code(502).send({ error: data.message || 'Ошибка отправки SMS' })
      }
      return { ok: true }
    } catch (e) {
      req.log.error(e)
      return reply.code(502).send({ error: 'Ошибка отправки SMS' })
    }
  })
}
