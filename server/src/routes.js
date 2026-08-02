import { config } from './config.js'
import { supabaseAdmin } from './supabase.js'
import { normalizePhone, getOrCreateAuthUserByPhone, linkWaiterToAuthUser, setUserPassword, passwordGrant, randomPassword } from './gotrue.js'
import { sendPushForCall } from './webpush.js'
import { sendSmsCode, verifySmsCode } from './sms.js'

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

    const result = await sendSmsCode(phone, (code) => `Ваш код для входа: ${code}`, 'waiter')
    if (!result.ok) {
      if (result.status >= 500) req.log.error(result.error)
      return reply.code(result.status).send({ error: result.error })
    }
    return { ok: true }
  })

  app.post('/api/verify-sms', async (req, reply) => {
    const phone = normalizePhone(req.body?.phone)
    const code = String(req.body?.code ?? '').trim()
    if (!/^\+7\d{10}$/.test(phone) || !/^\d{4}$/.test(code)) {
      return reply.code(400).send({ error: 'phone и 4-значный code обязательны' })
    }

    const codeCheck = await verifySmsCode(phone, code, 'waiter')
    if (!codeCheck.ok) {
      if (codeCheck.status >= 500) req.log.error(codeCheck.error)
      return reply.code(codeCheck.status).send({ error: codeCheck.error })
    }

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

    // Выпускаем НАСТОЯЩУЮ сессию через GoTrue: ставим одноразовый пароль
    // и сразу логинимся им (grant_type=password). GoTrue сам создаёт сессию
    // и refresh_token в auth.* — нам не нужно лезть в его таблицы.
    let session
    try {
      const pwd = randomPassword()
      await setUserPassword(authUser.id, pwd)
      session = await passwordGrant(phone, pwd)
    } catch (e) {
      req.log.error(e)
      return reply.code(502).send({ error: 'Auth session: ' + e.message })
    }

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type ?? 'bearer',
      user: { id: authUser.id, phone, waiter_id: waiterId },
    }
  })

  // ───────────────────────────────────────────────────────────────────────
  // WEB PUSH (вызов официанта — доставка при полностью свёрнутом приложении)
  // ───────────────────────────────────────────────────────────────────────
  //
  // Гостевое приложение дёргает это сразу после успешного call_waiter(),
  // передавая id только что созданного вызова — вся логика "кому именно
  // слать" (конкретный официант / широковещательно) читается из самой БД
  // по этому id, здесь ничего не передаётся и не доверяется от клиента,
  // кроме id. VAPID-приватник живёт только в этом сервисе.
  app.post('/api/send-waiter-call-push', async (req, reply) => {
    const callId = String(req.body?.callId || '').trim()
    if (!callId) {
      return reply.code(400).send({ error: 'callId обязателен' })
    }
    try {
      const result = await sendPushForCall(callId)
      return { ok: true, sent: result.sent }
    } catch (e) {
      req.log.error(e)
      // Push — дополнительный канал поверх Realtime, не основной.
      // Не роняем гостевое приложение из-за проблем с доставкой push.
      return reply.code(200).send({ ok: false })
    }
  })

  // ───────────────────────────────────────────────────────────────────────
  // ВИКТОРИНА ГОСТЯ (RestAI) — регистрация телефона для программы баллов.
  // ───────────────────────────────────────────────────────────────────────
  //
  // В отличие от /api/verify-sms (официант, полноценная сессия GoTrue),
  // тут нет входа/JWT — гость и так идентифицирован по device_id, SMS
  // нужен только чтобы подтвердить, что телефон настоящий, прежде чем
  // сохранять результат викторины и начислять баллы.
  //
  // Само начисление баллов (и повторная проверка правильности ответа —
  // клиенту тут не доверяем) — внутри register_guest_and_credit_quiz,
  // вызывается только отсюда, с сервисным ключом.

  app.post('/api/guest/send-sms', async (req, reply) => {
    const phone = normalizePhone(req.body?.phone)
    if (!/^\+7\d{10}$/.test(phone)) {
      return reply.code(400).send({ error: 'Неверный формат телефона' })
    }

    const result = await sendSmsCode(phone, (code) => `Ваш код для участия в викторине RestAI: ${code}`, 'guest')
    if (!result.ok) {
      if (result.status >= 500) req.log.error(result.error)
      return reply.code(result.status).send({ error: result.error })
    }
    return { ok: true }
  })

  app.post('/api/guest/verify-sms', async (req, reply) => {
    const phone = normalizePhone(req.body?.phone)
    const code = String(req.body?.code ?? '').trim()
    const deviceId = String(req.body?.deviceId ?? '').trim()
    const name = String(req.body?.name ?? '').trim()
    const questionId = req.body?.questionId ? String(req.body.questionId).trim() : null
    const selectedIndex = req.body?.selectedIndex != null ? Number(req.body.selectedIndex) : null

    if (!/^\+7\d{10}$/.test(phone) || !/^\d{4}$/.test(code)) {
      return reply.code(400).send({ error: 'phone и 4-значный code обязательны' })
    }
    if (!deviceId || !name) {
      return reply.code(400).send({ error: 'deviceId и name обязательны' })
    }

    const codeCheck = await verifySmsCode(phone, code, 'guest')
    if (!codeCheck.ok) {
      if (codeCheck.status >= 500) req.log.error(codeCheck.error)
      return reply.code(codeCheck.status).send({ error: codeCheck.error })
    }

    const { data, error } = await supabaseAdmin.rpc('register_guest_and_credit_quiz', {
      p_device_id: deviceId,
      p_name: name,
      p_phone: phone,
      p_question_id: questionId,
      p_selected_index: selectedIndex,
    })

    if (error) {
      req.log.error(error)
      return reply.code(502).send({ error: 'Не удалось сохранить регистрацию' })
    }

    const result = data?.[0]
    if (result?.phone_taken) {
      return reply.code(409).send({ error: 'Этот номер телефона уже зарегистрирован' })
    }
    if (!result?.ok) {
      return reply.code(404).send({ error: 'Гость не найден — откройте меню заново' })
    }

    return { ok: true, points: result.points }
  })
}
