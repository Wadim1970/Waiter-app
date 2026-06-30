import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { config } from './config.js'
import { supabaseAdmin } from './supabase.js'
import { signAccessToken, generateRefreshToken } from './jwt.js'
import { normalizePhone, getOrCreateAuthUserByPhone, linkWaiterToAuthUser, persistRefreshToken } from './gotrue.js'

// Разрешённые типы файлов для документов официанта
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])

// Разрешённые префиксы путей в бакете (защита от записи в чужие каталоги)
const ALLOWED_PATH = /^(passport|medical-book|personal_photos)\/[a-zA-Z0-9_\-/]+$/

function randomId() {
  return Math.random().toString(36).slice(2, 9)
}

// Простой 4-значный SMS-код. Криптографически случайный.
function generateSmsCode() {
  // 0000..9999 равномерно
  const buf = crypto.getRandomValues(new Uint32Array(1))
  const n = buf[0] % 10000
  return n.toString().padStart(4, '0')
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

  // ───────────────────────────────────────────────────────────────────────
  // SMS-АУТЕНТИФИКАЦИЯ (новый поток, Этап 2)
  // ───────────────────────────────────────────────────────────────────────
  //
  // /api/send-sms:
  //   - waiter-api сам генерирует 4-значный код,
  //   - хеширует bcrypt и кладёт в public.sms_codes,
  //   - просит n8n отправить готовый текст (n8n больше НЕ генерирует код).
  //
  // /api/verify-sms:
  //   - проверяет код по хешу,
  //   - создаёт/находит пользователя в auth.users (GoTrue Admin API),
  //   - привязывает строку в public.waiters,
  //   - возвращает фронту JWT (access + refresh).

  app.post('/api/send-sms', async (req, reply) => {
    const phone = normalizePhone(req.body?.phone)
    if (!/^\+7\d{10}$/.test(phone)) {
      return reply.code(400).send({ error: 'Неверный формат телефона' })
    }

    // Защита от спама: не чаще одного SMS в SMS_RESEND_COOLDOWN_SEC сек
    const cooldownAgo = new Date(Date.now() - config.smsResendCooldownSec * 1000).toISOString()
    const { data: recent } = await supabaseAdmin
      .from('sms_codes')
      .select('id')
      .eq('phone', phone)
      .gt('created_at', cooldownAgo)
      .limit(1)
      .maybeSingle()
    if (recent) {
      return reply.code(429).send({ error: 'Подождите перед повторной отправкой кода' })
    }

    // Чистим все старые коды для этого телефона
    await supabaseAdmin.from('sms_codes').delete().eq('phone', phone)

    const code = generateSmsCode()
    const codeHash = bcrypt.hashSync(code, 10)
    const expiresAt = new Date(Date.now() + config.smsCodeTtlSec * 1000).toISOString()

    const { error: insErr } = await supabaseAdmin
      .from('sms_codes')
      .insert({ phone, code_hash: codeHash, expires_at: expiresAt })
    if (insErr) {
      req.log.error(insErr)
      return reply.code(500).send({ error: 'Не удалось сохранить код' })
    }

    // Просим n8n отправить SMS. n8n теперь — просто транспорт.
    try {
      const res = await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': config.n8nWebhookSecret,
        },
        body: JSON.stringify({
          phone,
          text: `Ваш код для входа: ${code}`,
          // Поля ниже для обратной совместимости со старым воркфлоу n8n,
          // пока он их ещё ждёт. Можно удалить после обновления n8n.
          code,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        return reply.code(502).send({ error: data.message || 'Ошибка отправки SMS' })
      }
    } catch (e) {
      req.log.error(e)
      return reply.code(502).send({ error: 'Ошибка отправки SMS' })
    }

    return { ok: true }
  })

  app.post('/api/verify-sms', async (req, reply) => {
    const phone = normalizePhone(req.body?.phone)
    const code = String(req.body?.code ?? '').trim()
    if (!/^\+7\d{10}$/.test(phone) || !/^\d{4}$/.test(code)) {
      return reply.code(400).send({ error: 'phone и 4-значный code обязательны' })
    }

    // Берём последний активный код
    const { data: row, error: selErr } = await supabaseAdmin
      .from('sms_codes')
      .select('id, code_hash, attempts, expires_at, consumed_at')
      .eq('phone', phone)
      .is('consumed_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (selErr) {
      req.log.error(selErr)
      return reply.code(500).send({ error: 'Ошибка проверки кода' })
    }
    if (!row) {
      return reply.code(400).send({ error: 'Код не запрашивался или уже использован' })
    }
    if (new Date(row.expires_at) < new Date()) {
      return reply.code(400).send({ error: 'Код истёк, запросите новый' })
    }
    if (row.attempts >= config.smsMaxAttempts) {
      return reply.code(429).send({ error: 'Слишком много попыток. Запросите новый код.' })
    }

    const ok = bcrypt.compareSync(code, row.code_hash)
    if (!ok) {
      await supabaseAdmin.from('sms_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
      return reply.code(401).send({ error: 'Неверный код' })
    }

    // Помечаем код использованным сразу — даже если что-то ниже упадёт,
    // повторно по этому коду войти не получится.
    await supabaseAdmin.from('sms_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)

    // Создаём/находим пользователя в auth.users
    let authUser
    try {
      authUser = await getOrCreateAuthUserByPhone(phone)
    } catch (e) {
      req.log.error(e)
      return reply.code(502).send({ error: 'Auth: ' + e.message })
    }

    // Привязываем строку в public.waiters
    let waiterId
    try {
      waiterId = await linkWaiterToAuthUser({ phone, authUserId: authUser.id })
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: 'Не удалось обновить waiters: ' + e.message })
    }

    // Выпускаем токены
    const accessToken = signAccessToken({ userId: authUser.id, phone })
    const refreshToken = generateRefreshToken()
    try {
      await persistRefreshToken({ userId: authUser.id, refreshToken })
    } catch (e) {
      req.log.error(e)
      return reply.code(500).send({ error: 'Не удалось сохранить сессию: ' + e.message })
    }

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: config.jwtAccessTtlSec,
      token_type: 'bearer',
      user: { id: authUser.id, phone, waiter_id: waiterId },
    }
  })
}
