// Разовая настройка демо-входа (кнопка «Вход» → код 1111) на сервере.
//
//   cd /opt/restai/Waiter-app && node scripts/demo-waiter-setup.mjs
//   pm2 reload restai-waiter-api --update-env
//
// Что делает (повторный запуск безопасен):
//   1. Если в .env.production нет DEMO_WAITER_PASSWORD — генерирует и дописывает
//      (в консоль не печатает).
//   2. Создаёт (или обновляет пароль) auth-пользователя демо-официанта по
//      телефону-заглушке DEMO_WAITER_PHONE (+70000000001).
//   3. Создаёт строку в waiters и привязывает её к этому пользователю.
//   4. Закрепляет за ним столы DEMO_TABLES (1–9) «Сыроварни» навсегда,
//      заводит смену на сегодня, проверяет, что вход паролем работает.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const envFile = path.resolve('.env.production')
if (!fs.existsSync(envFile)) {
  console.error(`Нет ${envFile} — запускайте из папки Waiter-app на сервере`)
  process.exit(1)
}
const readEnv = () => {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
readEnv()
if (!process.env.DEMO_WAITER_PASSWORD) {
  const pwd = crypto.randomBytes(24).toString('base64url')
  const text = fs.readFileSync(envFile, 'utf8')
  fs.writeFileSync(envFile, `${text.replace(/\n?$/, '\n')}# Демо-вход официанта (кнопка «Вход» → код). Пароль служебный, никому не нужен.\nDEMO_WAITER_PASSWORD=${pwd}\n`)
  readEnv()
  console.log('• DEMO_WAITER_PASSWORD сгенерирован и записан в .env.production')
}

const {
  demoConfig, adminClient, demoPasswordGrant, findDemoWaiterId,
  ensureTableAssignments, ensureTodayShift, resetDemoName,
} = await import('../api/_lib/demoWaiter.js')

const cfg = demoConfig()
if (!cfg.supabaseUrl || !cfg.serviceKey) {
  console.error('В .env.production нужны SUPABASE_URL и SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const admin = (p) => `${cfg.supabaseUrl}/auth/v1/admin${p}`
const headers = { apikey: cfg.serviceKey, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': 'application/json' }

async function findAuthUserByPhone(phone) {
  const bare = phone.replace(/^\+/, '')
  for (let page = 1; page < 50; page++) {
    const res = await fetch(admin(`/users?page=${page}&per_page=200`), { headers })
    if (!res.ok) throw new Error(`GoTrue users ${res.status}`)
    const users = (await res.json())?.users ?? []
    const hit = users.find((u) => u.phone === bare || u.phone === phone)
    if (hit) return hit
    if (users.length < 200) return null
  }
  return null
}

let user = await findAuthUserByPhone(cfg.phone)
if (user) {
  const res = await fetch(admin(`/users/${user.id}`), { method: 'PUT', headers, body: JSON.stringify({ password: cfg.password }) })
  if (!res.ok) throw new Error(`GoTrue update ${res.status}: ${await res.text()}`)
  console.log('• Аккаунт демо-официанта найден, пароль обновлён')
} else {
  const res = await fetch(admin('/users'), {
    method: 'POST', headers,
    body: JSON.stringify({ phone: cfg.phone, password: cfg.password, phone_confirm: true }),
  })
  if (!res.ok) throw new Error(`GoTrue create ${res.status}: ${await res.text()}`)
  user = await res.json()
  console.log('• Аккаунт демо-официанта создан')
}

const db = adminClient(cfg)
let waiterId = await findDemoWaiterId(db, user.id)
if (!waiterId) {
  const { data: byPhone } = await db.from('waiters').select('id').eq('phone', cfg.phone).maybeSingle()
  if (byPhone?.id) {
    const { error } = await db.from('waiters').update({ auth_user_id: user.id, phone_verified: true }).eq('id', byPhone.id)
    if (error) throw error
    waiterId = byPhone.id
  } else {
    const { data, error } = await db.from('waiters').insert({
      phone: cfg.phone,
      first_name: cfg.name,
      phone_verified: true,
      auth_user_id: user.id,
    }).select('id').single()
    if (error) throw error
    waiterId = data.id
  }
  console.log('• Официант в базе создан')
}
await resetDemoName(db, cfg, waiterId)

const { tables, added } = await ensureTableAssignments(db, cfg, waiterId)
console.log(`• Столы ${tables.join(', ') || '— не найдены!'} закреплены навсегда (добавлено ${added})`)
if (!tables.length) console.log(`  ⚠ В ресторане ${cfg.restaurantId} нет столов ${cfg.tableFrom}–${cfg.tableTo}`)

try {
  await ensureTodayShift(db, cfg, waiterId)
  console.log('• Смена на сегодня подтверждена')
} catch (e) {
  console.log(`  ⚠ Смену на сегодня завести не удалось (${e.message}). Вход всё равно работает: приложение пускает демо-официанта к столам без смены.`)
}

await demoPasswordGrant(cfg)
console.log(`• Проверка входа: ок. Код для входа: ${cfg.code}`)
console.log('\nТеперь: pm2 reload restai-waiter-api --update-env')
