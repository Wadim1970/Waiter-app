import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import { config } from './config.js'
import { supabaseAdmin } from './supabase.js'

// Простой 4-значный SMS-код. Криптографически случайный.
export function generateSmsCode() {
  // 0000..9999 равномерно
  const buf = crypto.getRandomValues(new Uint32Array(1))
  const n = buf[0] % 10000
  return n.toString().padStart(4, '0')
}

// Общая логика отправки кода — используется и для входа официанта
// (/api/send-sms), и для регистрации гостя в викторине
// (/api/guest/send-sms). Один и тот же номер телефона вполне может
// принадлежать и официанту, и гостю одновременно — это разные
// сущности, поэтому purpose ('waiter' | 'guest') обязателен и
// участвует во всех проверках/операциях наравне с phone: код,
// запрошенный для одной цели, не должен быть виден или затираться
// запросом кода для другой.
//
// buildMessage — функция (code) => текст SMS: код генерируется ВНУТРИ
// этой функции, вызывающий его заранее не знает, поэтому текст нельзя
// собрать снаружи и передать готовой строкой.
export async function sendSmsCode(phone, buildMessage, purpose) {
  // Защита от спама: не чаще одного SMS в SMS_RESEND_COOLDOWN_SEC сек
  const cooldownAgo = new Date(Date.now() - config.smsResendCooldownSec * 1000).toISOString()
  const { data: recent } = await supabaseAdmin
    .from('sms_codes')
    .select('id')
    .eq('phone', phone)
    .eq('purpose', purpose)
    .gt('created_at', cooldownAgo)
    .limit(1)
    .maybeSingle()
  if (recent) {
    return { ok: false, status: 429, error: 'Подождите перед повторной отправкой кода' }
  }

  // Чистим старые коды для этого телефона и ЭТОЙ ЖЕ цели — код
  // официанта для этого номера (если есть) не трогаем.
  await supabaseAdmin.from('sms_codes').delete().eq('phone', phone).eq('purpose', purpose)

  const code = generateSmsCode()
  const codeHash = bcrypt.hashSync(code, 10)
  const expiresAt = new Date(Date.now() + config.smsCodeTtlSec * 1000).toISOString()

  const { error: insErr } = await supabaseAdmin
    .from('sms_codes')
    .insert({ phone, code_hash: codeHash, expires_at: expiresAt, purpose })
  if (insErr) {
    return { ok: false, status: 500, error: 'Не удалось сохранить код' }
  }

  // Просим n8n отправить SMS. n8n теперь — просто транспорт.
  try {
    const res = await fetch(config.n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': config.n8nWebhookSecret,
      },
      body: JSON.stringify({ phone, text: buildMessage(code), code }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: false, status: 502, error: data.message || 'Ошибка отправки SMS' }
    }
  } catch {
    return { ok: false, status: 502, error: 'Ошибка отправки SMS' }
  }

  return { ok: true }
}

// Общая логика проверки кода — только сверка/пометка использованным,
// без того, что происходит ПОСЛЕ успеха (у официанта — сессия GoTrue,
// у гостя — запись профиля), это остаётся в каждом роуте отдельно.
export async function verifySmsCode(phone, code, purpose) {
  const { data: row, error: selErr } = await supabaseAdmin
    .from('sms_codes')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('phone', phone)
    .eq('purpose', purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (selErr) {
    return { ok: false, status: 500, error: 'Ошибка проверки кода' }
  }
  if (!row) {
    return { ok: false, status: 400, error: 'Код не запрашивался или уже использован' }
  }
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, status: 400, error: 'Код истёк, запросите новый' }
  }
  if (row.attempts >= config.smsMaxAttempts) {
    return { ok: false, status: 429, error: 'Слишком много попыток. Запросите новый код.' }
  }

  const matches = bcrypt.compareSync(code, row.code_hash)
  if (!matches) {
    await supabaseAdmin.from('sms_codes').update({ attempts: row.attempts + 1 }).eq('id', row.id)
    return { ok: false, status: 401, error: 'Неверный код' }
  }

  // Помечаем код использованным сразу — даже если что-то после этого
  // упадёт, повторно по этому коду войти/подтвердиться не получится.
  await supabaseAdmin.from('sms_codes').update({ consumed_at: new Date().toISOString() }).eq('id', row.id)
  return { ok: true }
}
