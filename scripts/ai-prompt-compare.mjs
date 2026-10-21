// Сравнение подсказок официанту: прежние промпты (v8) против новых (v9) на
// живом меню ресторана. Ничего не пишет в базу и в кэш подсказок.
//
//   cd /opt/restai/Waiter-app && node scripts/ai-prompt-compare.mjs
//   (другой ресторан: RESTAURANT_ID=<uuid> …; окружение из другого места:
//   ENV_FILE=/путь/.env.production …)
//
// Печатает по каждому заказу, что посоветовал старый и новый вариант и за
// сколько секунд, и сохраняет то же в ai-compare-<время>.txt. Ключей и
// персональных данных в выводе нет — его можно пересылать.
import fs from 'node:fs'
import path from 'node:path'

const envFile = path.resolve(process.env.ENV_FILE || '.env.production')
if (!fs.existsSync(envFile)) {
  console.error(`Нет ${envFile} — запускайте из папки Waiter-app на сервере`)
  process.exit(1)
}
for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
}
if (!process.env.DEEPSEEK_API_KEY) {
  console.error('В .env.production нет DEEPSEEK_API_KEY — сравнивать нечего (в приложении сейчас шаблоны)')
  process.exit(1)
}

// Импорт после чтения окружения: suggestService создаёт клиент Supabase при загрузке.
const { buildDigest } = await import('../api/_lib/suggestService.js')
const core = await import('../api/_lib/suggestCore.js')
const legacy = await import('../api/_lib/legacyPromptsV8.js')

const RESTAURANT_ID = process.env.RESTAURANT_ID || 'dd89773c-0952-4fd1-9510-514094a928ee' // «Сыроварня»
const BASE = (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

// Как deepseekChat в suggestService, но ещё отдаёт время и попадание в кэш DeepSeek.
async function chat(messages, { maxTokens = 700, timeoutMs, temperature }) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' }, temperature, max_tokens: maxTokens }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return {
      content: data?.choices?.[0]?.message?.content,
      ms: Date.now() - started,
      promptTokens: data?.usage?.prompt_tokens,
      cachedTokens: data?.usage?.prompt_cache_hit_tokens,
    }
  } catch (e) {
    return { content: null, ms: Date.now() - started, error: e.name === 'AbortError' ? `таймаут ${timeoutMs / 1000} с` : e.message }
  } finally {
    clearTimeout(timer)
  }
}

// Заказы для проверки (названия — из меню «Сыроварни»; для другого ресторана
// ненайденные блюда просто пропускаются).
const SCENARIOS = [
  { guest: { partySize: 2, occasion: 'свидание' }, cart: ['Стейк Рибай', 'Салат с Бурратой, печеным перцем и помидорами'], tag: 'к заказу', widget: true },
  { guest: { partySize: 1 }, cart: ['Борщ'], tag: 'к заказу', widget: true },
  { guest: { partySize: 4, occasion: 'день рождения' }, cart: ['Пепперони', 'Четыре сыра'], tag: 'напитки', widget: true },
  { guest: { partySize: 2, occasion: 'деловая встреча' }, cart: ['Лосось терияки с салатом из огурца', 'Медальоны филе-миньон'], tag: 'алкоголь' },
  { guest: { partySize: 1, preferences: 'не ест рыбу и морепродукты' }, cart: ['Спагетти Карбонара'], tag: 'к заказу', widget: true },
  { guest: { partySize: 3, occasion: 'семья с ребёнком' }, cart: ['Котлеты из индейки с картофельным пюре', 'Лапша куриная'], tag: 'десерты' },
  { guest: { partySize: 2 }, cart: ['Капрезе', 'Фокачча с прованскими травами'], tag: 'к заказу' },
  { guest: { partySize: 1, preferences: 'без чеснока' }, cart: ['Салат с цыпленком и Пармезаном'], tag: 'мясо' },
  { guest: { partySize: 2, preferences: 'не пьют алкоголь' }, cart: ['Свиные ребра в соусе барбекю', 'Шашлык из курицы'], tag: 'напитки', widget: true },
  { guest: { partySize: 1 }, cart: ['Медовик с соленой карамелью и фундуком'], tag: 'напитки' },
  { guest: { partySize: 2, occasion: 'романтический ужин' }, cart: [], tag: 'к заказу' },
  { guest: { partySize: 4, occasion: 'компания друзей' }, cart: ['Брускетта с тамбовским окороком', 'Запеченный Халлуми с томатами и базиликом'], tag: 'закуски/салаты' },
]

const digest = await buildDigest(RESTAURANT_ID)
const byName = new Map(digest.map((d) => [d.name.trim().toLowerCase(), d]))
const menu = core.menuForPrompt(digest)
const nameOf = new Map(digest.map((d) => [d.id, d.name]))

const lines = []
const out = (s = '') => { console.log(s); lines.push(s) }
const fmtCall = (r) => r.error
  ? `${(r.ms / 1000).toFixed(1)} с, ${r.error} → шаблон`
  : `${(r.ms / 1000).toFixed(1)} с${r.promptTokens ? `, промпт ${r.promptTokens} ток.${r.cachedTokens ? ` (из кэша ${r.cachedTokens})` : ''}` : ''}`
const fmtPicks = (picks) => picks && picks.length
  ? picks.map((p) => `    • ${nameOf.get(p.dishId)} — ${p.pitch}${p.addon ? ` (+ ${p.addon})` : ''}`).join('\n')
  : '    (пусто → в приложении был бы шаблон)'

const guestText = (g) => [g.partySize && `гостей ${g.partySize}`, g.occasion, g.preferences].filter(Boolean).join(', ')

out(`Сравнение подсказок: ресторан ${RESTAURANT_ID}, в меню для модели ${menu.byNum.size} позиций, модель ${MODEL}`)
out(`Время: ${new Date().toISOString()}`)

const totals = { old: [], new: [] }
for (const [i, sc] of SCENARIOS.entries()) {
  const cartItems = sc.cart.map((n) => byName.get(n.toLowerCase())).filter(Boolean)
  const cartIds = cartItems.map((d) => d.id)
  const cartNames = cartItems.map((d) => d.name)
  out()
  out(`━━ ${i + 1}. ${guestText(sc.guest)}. В заказе: ${cartNames.join(', ') || '—'}. Официант ищет: ${sc.tag}`)

  // Прежний путь: пул из 12 кандидатов (маржа + регэкспы) → промпт v8.
  const cartHasMain = cartItems.some((d) => core.categoryOf(d) === 'main')
  const excludeMain = (!sc.tag || sc.tag === 'к заказу') && cartHasMain
  const pool = core.rankCandidates(digest, { tag: sc.tag, exclude: cartIds, limit: 12, excludeMain })

  const [oldRes, newRes] = await Promise.all([
    pool.length
      ? chat(legacy.buildMessages({ candidates: pool, stage: null, tag: sc.tag, guest: sc.guest, cart: cartNames }), { timeoutMs: 6000, temperature: 0.6 })
      : Promise.resolve({ content: null, ms: 0, error: 'пустой пул кандидатов' }),
    chat(core.buildSuggestMessages({ menu, stage: null, tag: sc.tag, guest: sc.guest, cart: cartNames, offeredIds: [] }), { timeoutMs: 12000, temperature: 0.5 }),
  ])
  totals.old.push(oldRes.ms); totals.new.push(newRes.ms)
  out(`  СТАРЫЙ (${fmtCall(oldRes)}):`)
  out(fmtPicks(legacy.parsePitches(oldRes.content, pool)))
  out(`  НОВЫЙ (${fmtCall(newRes)}):`)
  out(fmtPicks(core.parsePicks(newRes.content, menu, new Set(cartIds))))

  if (sc.widget) {
    const pools = core.pickPools(digest, { exclude: cartIds })
    const [oldW, newW] = await Promise.all([
      chat(legacy.buildRecommendMessages({ cart: cartNames, pools, guest: sc.guest }), { maxTokens: 500, timeoutMs: 9000, temperature: 0.6 }),
      chat(core.buildRecommendMessages({ menu, cart: cartNames, guest: sc.guest }), { maxTokens: 500, timeoutMs: 12000, temperature: 0.5 }),
    ])
    out(`  Виджет «Подсказка от RestAI»:`)
    out(`    СТАРЫЙ (${fmtCall(oldW)}): ${core.parseRecommendText(oldW.content) || '— → шаблон'}`)
    out(`    НОВЫЙ (${fmtCall(newW)}): ${core.parseRecommendText(newW.content) || '— → шаблон'}`)
  }
}

const avg = (a) => (a.reduce((s, x) => s + x, 0) / Math.max(1, a.length) / 1000).toFixed(1)
const max = (a) => (Math.max(...a) / 1000).toFixed(1)
out()
out(`Время ответа карточек: старый в среднем ${avg(totals.old)} с (макс. ${max(totals.old)}), новый ${avg(totals.new)} с (макс. ${max(totals.new)})`)

const file = path.resolve(`ai-compare-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.txt`)
fs.writeFileSync(file, `${lines.join('\n')}\n`)
console.log(`\nСохранено: ${file}`)
