// AI-коуч официанта — ЧИСТАЯ логика (без БД и сети, поэтому юнит-тестируется).
// DeepSeek по всему меню выбирает, что предложить, и пишет «скрипт» — что
// сказать гостю. Детерминированный ранжировщик — запасной путь без ИИ. Здесь
// только правила выбора, бейджи, шаблонные подсказки и сборка/разбор промпта.

// Тег официанта → как отфильтровать меню. Регэкспы регистронезависимы (кириллица).
// Секционные теги (еда). Напитки и алкоголь — отдельные ветки в matchesTag.
export const TAG_FILTERS = {
  'закуски/салаты': /закуск|салат|брускетт|карпаччо|тартар|севиче|намазк|хумус|ассорти|тарелк|рулет|рол{1,2}ы|начос|чипс|гуакамол|антипаст|винегрет|оливье|цезар|греческ/i,
  'супы':          /суп|похлёбк|похлебк|борщ|уха|солянк|бульон|том\s?ям|рамен|крем-?суп|гаспачо/i,
  'мясо':          /стейк|рибай|миньон|говядин|мяс|бургер|ребр|каре|ягн|утк|телятин|свин|кури|цыпл|шашлык|котлет|бефстроганов|вырезк|окорок/i,
  'рыба':          /рыб|сёмг|семг|лосос|форел|дорад|сибас|тунец|угорь|треск|судак|палтус|окун|скумбри|карп/i,
  'морепродукты':  /креветк|устриц|мид|краб|осьминог|кальмар|гребешок|морепрод|лангустин|каракатиц|лобстер|раки/i,
  'десерты':       /десерт|торт|чизкейк|морож|тирамису|пирог|панакот|наполеон|штрудел|сырник|крем-?брюле|мусс|эклер|макарон/i,
}

// Приёмы продаж, которыми ИИ формулирует реплику. Коды логируются в
// ai_suggestion_events — на них учится модель (какой приём лучше конвертит).
export const TECHNIQUES = new Set(['taste_pairing', 'social_proof', 'choice_no_choice', 'scarcity'])

const DRINK_RE = /напит|сок|лимонад|коктейл|кофе|чай|раф|смузи|морс|компот|тоник|вода|милкшейк|какао|эспрессо|капучино|латте/i
const ALCO_RE  = /вино|бокал|игрист|просекко|шампан|виски|коньяк|аперол|пиво|ром\b|текил|джин|ликёр|ликер|вермут|портвейн|наливк|глинтвейн|сидр|виск/i

function isAlcohol(item) {
  return item.productType === 'alcohol' || ALCO_RE.test(`${item.name || ''} ${item.section || ''}`)
}
function isDrink(item) {
  return item.productType === 'drink' || DRINK_RE.test(`${item.name || ''} ${item.section || ''}`)
}

export function matchesTag(item, tag) {
  // «К заказу» (тег по умолчанию) — ТОЛЬКО ЕДА: широкий пул сочетаний к уже
  // выбранному, из которого ИИ выбирает лучшие. Напитки и алкоголь сюда НЕ
  // попадают — их официант получает лишь по явному тегу «напитки»/«алкоголь».
  if (!tag || tag === 'к заказу') return !isDrink(item) && !isAlcohol(item)
  if (tag === 'напитки')    return isDrink(item) && !isAlcohol(item)
  if (tag === 'алкоголь')   return isAlcohol(item)
  const re = TAG_FILTERS[tag]
  if (!re) return true
  return re.test(`${item.name || ''} ${item.section || ''}`)
}

// Чем выше — тем раньше предлагаем. Ручной push доминирует, затем «истекает»
// (продать в первую очередь) и спец дня, и уже потом абсолютная прибыль.
export function scoreOf(item) {
  return (item.pushPriority || 0) * 100000
    + (item.dailyFlag === 'expiring' ? 50000 : 0)
    + (item.dailyFlag === 'special' ? 20000 : 0)
    + Number(item.marginAbs || 0)
}

// Выбор кандидатов: доступные, не в стоп-листе (86), не исключённые, под тег,
// отсортированные по выгоде (маржа/флаги дня). Это ПУЛ — из него ИИ сам
// выбирает сочетания; поэтому limit может быть широким (до 12).
// excludeMain — убрать конкурирующие ОСНОВНЫЕ блюда (когда такое уже в заказе:
// заказал стейк — не предлагаем второе горячее, а дополнение к нему).
export function rankCandidates(digest, { tag, exclude = [], limit = 3, excludeMain = false } = {}) {
  const ex = new Set(exclude)
  return (digest || [])
    .filter(i => i.available && i.dailyFlag !== 'stop' && !ex.has(i.id) && matchesTag(i, tag)
      && !(excludeMain && categoryOf(i) === 'main'))
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, Math.max(1, Math.min(Number(limit) || 3, 12)))
}

// Бейджи для официанта (не для гостя): почему это блюдо стоит предложить.
export function badgesFor(item) {
  const b = []
  if (item.dailyFlag === 'expiring') b.push('expiring')
  if (item.dailyFlag === 'special') b.push('special')
  if ((item.pushPriority || 0) >= 3) b.push('hit')
  if (Number(item.marginAbs || 0) >= 700) b.push('margin')
  return b
}

// Подсказка без ИИ (нет ключа DeepSeek или он не ответил) — шаблон.
export function templatePitch(item) {
  // Без ИИ — тот же формат: директива + произносимая реплика в «…» (её жирнит
  // фронт). Название блюда — без кавычек. Без «гости часто берут»: данных о
  // популярности у нас нет, а выдуманное гость чувствует.
  return `Предложите ${item.name}: «к вашему заказу хорошо подойдёт ${item.name} — принести?»`
}

// ── Промпты v9: модель видит всё меню и короткие принципы ──────────────────
// Раньше код сам отбирал модели 12 кандидатов (по марже и регэкспам названий)
// и навязывал приём продаж с примерами — подсказки выходили натянутыми и
// с выдуманными «хвалят»/«последняя порция». Теперь выбирает модель, по
// всему меню; код держит только жёсткие запреты (стоп-лист, уже в заказе,
// уже предлагали, номер из меню).

const MENU_DESC_MAX = 160
// Состав целиком (обрезанный список обманул бы: «чеснока не видно — значит,
// нет»). +~11 тыс. токенов у «Сыроварни», но начало промпта DeepSeek кэширует.
const MENU_INGR_MAX = 600

// Меню для промпта: строки по разделам, короткие номера вместо uuid (меньше
// токенов и не перепутать). Порядок стабильный — тогда начало промпта у
// ресторана одно и то же, и DeepSeek берёт его из своего кэша (быстрее и
// дешевле). Повторы одного блюда в разных разделах («Популярное») — один раз.
export function menuForPrompt(digest) {
  const byNum = new Map()
  const seen = new Set()
  const sections = new Map()
  for (const it of digest || []) {
    if (!it.available || it.dailyFlag === 'stop') continue
    const key = String(it.name || '').trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const section = it.section || 'Без раздела'
    if (!sections.has(section)) sections.set(section, [])
    sections.get(section).push(it)
  }
  const lines = []
  for (const [section, items] of sections) {
    lines.push(`## ${section}`)
    for (const it of items) {
      const n = byNum.size + 1
      byNum.set(n, it)
      const desc = (it.description || '').replace(/\s+/g, ' ').trim().slice(0, MENU_DESC_MAX).replace(/[.\s]+$/, '')
      const ingr = (Array.isArray(it.ingredients) ? it.ingredients.join(', ') : '').replace(/\s+/g, ' ').trim().slice(0, MENU_INGR_MAX)
      const marks = [
        (it.pushPriority || 0) > 0 ? `приоритет${it.pushReason ? `: ${it.pushReason}` : ''}` : null,
        it.dailyFlag === 'expiring' ? 'заканчивается сегодня' : null,
        it.dailyFlag === 'special' ? `спец дня от шефа${it.dailyNote ? `: ${it.dailyNote}` : ''}` : null,
      ].filter(Boolean)
      const price = it.price != null ? ` — ${Math.round(Number(it.price))} ₽` : ''
      lines.push(`${n}. ${it.name}${price}${desc ? `. ${desc}` : ''}${ingr ? `. Состав: ${ingr}` : ''}${marks.length ? ` [${marks.join('; ')}]` : ''}`)
    }
  }
  return { text: lines.join('\n'), byNum }
}

// Общие принципы для обеих подсказок (карточки и виджет).
const PRINCIPLES = `Ты — опытный официант и сомелье. Помогаешь коллеге-официанту: подсказываешь, что предложить гостю и как это сказать.

Как думать:
- Смотри, что гость уже заказал, сколько людей за столом, какой повод и что гость не ест. Предлагай то, что действительно сделает заказ лучше: дополнит по вкусу, по сытности, по моменту (к горячему, к вину, на десерт, с собой). Хорошая подсказка — та, за которую гость скажет спасибо.
- Не предлагай второе горячее к горячему, лишнего одному гостю и ничего, что противоречит ограничениям гостя.
- Думай о моменте ужина: к одним закускам уместно горячее; к горячему — закуска, салат, гарнир, соус; десерт и кофе — когда гость доедает или сам о них спрашивает.
- Не додумывай, кто за столом что ест и почему, — исходи только из того, что дано.
- Про состав говори только то, что есть в описании и составе блюда. Не обещай гостю, что в блюде чего-то нет, если состав это не подтверждает, — в таком случае в offer напиши официанту уточнить у кухни.
- Пометка «приоритет» — блюдо выгодно ресторану: при прочих равных выбирай его, но уместность для гостя важнее. Гостю про выгоду не говори.
- Говори только правду. Не утверждай, что блюдо популярно, его хвалят или осталась последняя порция, — этого мы не знаем. Пометка «заканчивается сегодня» — можно честно сказать, что его осталось немного; «спец дня от шефа» — что шеф рекомендует его сегодня.
- Фраза для гостя — естественная, как сказал бы живой внимательный официант: одно-два коротких предложения, до 25 слов, без цен и без рекламных штампов.`

// Подсказка официанту собирается кодом из двух полей ответа модели: offer —
// что предложить, say — дословная фраза гостю. Раньше модель писала всё одной
// строкой и через раз теряла кавычки или вставляла «Скажи гостю:» — фраза
// не выделялась, а официант оставался без готовой реплики.
const OFFER_SAY_NOTE = `offer — коротко официанту, что предложить и почему (до 12 слов, без кавычек, без «скажи»).
say — дословно, что официант скажет гостю (без кавычек вокруг).`

function cleanSay(raw) {
  return String(raw || '').trim()
    .replace(/^(скажи(те)?( гостю)?|фраза( гостю)?|предложи(те)?)\s*:\s*/i, '')
    .replace(/[«»"„“]/g, '')
    .trim()
}

// offer + say → «Директива: «реплика»» (фронт выделяет текст в «…» жирным).
export function composePitch(offer, say) {
  const s = cleanSay(say)
  if (!s) return null
  const o = String(offer || '').trim().replace(/[«»"„“]/g, '').replace(/[\s.:;,—-]+$/, '')
  return o ? `${o}: «${s}»` : `«${s}»`
}

const TECHNIQUE_NOTE = `technique — приём, если он в фразе есть: taste_pairing (сочетание вкусов), choice_no_choice (выбор из двух вариантов), scarcity (заканчивается — только по пометке), social_proof (не используй); иначе null.`

function guestLineOf(guest) {
  const g = guest || {}
  return [
    g.partySize ? `гостей за столом: ${g.partySize}` : null,
    g.occasion && `повод: ${g.occasion}`,
    g.gender && `пол: ${g.gender}`,
    g.age && `возраст: ${g.age}`,
    g.preferences && `не ест / ограничения: ${g.preferences}`,
  ].filter(Boolean).join(', ') || 'ничего не известно'
}

// Номера блюд из меню по их id (для «уже в заказе»/«уже предлагали»).
function numsOf(menu, ids) {
  const want = new Set(ids || [])
  const out = []
  for (const [n, it] of menu.byNum) if (want.has(it.id)) out.push(n)
  return out
}

// Время дня — что уместно предлагать (меню в промте уже отфильтровано,
// строка объясняет модели почему).
const MEAL_HINT = {
  breakfast: 'Сейчас завтрак: уместны завтраки, выпечка, кофе, чай, соки; стейки, супы и алкоголь не предлагай.',
  lunch: 'Сейчас обед: уместны суп, горячее, салат, напитки.',
  dinner: 'Сейчас ужин: уместны закуски, горячее с соусом и гарниром, вино и напитки, десерт; суп сам не предлагай.',
  late: 'Сейчас поздний вечер: уместны лёгкие закуски, салаты, напитки и десерты; тяжёлое горячее не предлагай.',
}
export const mealHint = (meal) => MEAL_HINT[meal] || null

// Карточки-подсказки по тегу официанта (/api/waiter/suggest).
export function buildSuggestMessages({ menu, stage, tag, guest, cart, offeredIds, meal }) {
  const system = `${PRINCIPLES}
- Лучше одно точное предложение, чем три случайных. Предложи от 1 до 3 блюд, лучшее первым.

${OFFER_SAY_NOTE}
addon — необязательная короткая вторая пара к этому блюду (например, к десерту — кофе) или null.
${TECHNIQUE_NOTE}

Ответ — строго JSON: {"suggestions":[{"n":<номер блюда из меню>,"offer":"…","say":"…","technique":"…","addon":null}]}

Меню ресторана (номер. название — цена. описание [пометки]):
${menu.text}`

  const ask = !tag || tag === 'к заказу'
    ? 'что предложить к заказу (еду; напитки — только если официант попросит)'
    : tag === 'напитки'
      ? 'безалкогольные напитки — выбирай только из них, алкоголь не предлагай'
      : `«${tag}» — выбирай из этой части меню`
  const offered = numsOf(menu, offeredIds)
  const user = [
    `Гость: ${guestLineOf(guest)}.`,
    `Уже в заказе: ${cart && cart.length ? cart.join(', ') : 'пока ничего'}.`,
    stage ? `Момент обслуживания: ${stage}.` : null,
    mealHint(meal),
    `Официант ищет: ${ask}.`,
    offered.length ? `Уже предлагали, не повторяй: ${offered.join(', ')}.` : null,
  ].filter(Boolean).join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// Разбор ответа: номер → блюдо меню. Отбрасываем выдуманные номера, то, что
// уже в заказе/предлагали (banned — id), и повторы. null → шаблонный фолбэк.
export function parsePicks(content, menu, banned = new Set()) {
  if (!content) return null
  let obj
  try { obj = JSON.parse(content) } catch { return null }
  const arr = Array.isArray(obj) ? obj : (obj?.suggestions || obj?.items || [])
  if (!Array.isArray(arr)) return null
  const used = new Set()
  const out = []
  for (const x of arr) {
    const item = menu.byNum.get(Number(x?.n))
    if (!item || banned.has(item.id) || used.has(item.id)) continue
    const pitch = x.say ? composePitch(x.offer, x.say) : null
    if (!pitch) continue
    used.add(item.id)
    const addon = x.addon && String(x.addon).trim()
    out.push({
      dishId: item.id,
      pitch,
      technique: TECHNIQUES.has(x.technique) ? x.technique : null,
      addon: addon && addon.toLowerCase() !== 'null' ? addon : null,
    })
  }
  return out.length ? out : null
}

// Виджет «Подсказка от RestAI» на экране заказа: одна связная подсказка.
export function buildRecommendMessages({ menu, cart, guest, meal }) {
  const system = `${PRINCIPLES}

Гость уже сделал заказ. Дай официанту ОДНУ подсказку — одно, максимум два лучших дополнения к этому заказу из меню, по точным названиям. Не перечисляй варианты.
${OFFER_SAY_NOTE}

Ответ — строго JSON: {"offer":"…","say":"…"}

Меню ресторана (номер. название — цена. описание [пометки]):
${menu.text}`

  const user = [
    `Гость: ${guestLineOf(guest)}.`,
    `Уже в заказе: ${cart && cart.length ? cart.join(', ') : 'пока ничего'}.`,
    mealHint(meal),
  ].filter(Boolean).join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// ── Фолбэк виджета без ИИ ──
// Разбивка меню по категориям — для шаблонной подсказки, если ИИ недоступен.

// Категория блюда для набора-дополнения.
export function categoryOf(item) {
  const t = `${item.name || ''} ${item.section || ''}`
  if (item.productType === 'alcohol' || /вино|бокал|игрист|просекко|шампан|виски|коньяк|аперол/i.test(t)) return 'alco'
  if (item.productType === 'drink' || /сок|лимонад|морс|смузи|компот|кофе|чай|раф|коктейл|тоник|вода/i.test(t)) return 'soft'
  if (/десерт|торт|чизкейк|тирамису|морож|панакот|штрудел|сырник|пирог|наполеон/i.test(t)) return 'dessert'
  if (/пицц|паст|ризотто|горяч|стейк|бургер|котлет|рагу|филе|шашлык|запечён|гриль|мяс|рыб|том ям|плов/i.test(t)) return 'main'
  return null
}

// Пулы кандидатов-дополнений по категориям, каждый отсортирован по приоритету
// (маржа/флаги дня) и обрезан до top-N. Стоп-лист/недоступные/уже в корзине —
// исключаем.
export function pickPools(digest, { exclude = [], perCategory = 3 } = {}) {
  const ex = new Set(exclude)
  const cats = { main: [], alco: [], soft: [], dessert: [] }
  for (const it of digest || []) {
    if (!it.available || it.dailyFlag === 'stop' || ex.has(it.id)) continue
    const c = categoryOf(it)
    if (c && cats[c]) cats[c].push(it)
  }
  for (const k of Object.keys(cats)) {
    cats[k].sort((a, b) => scoreOf(b) - scoreOf(a))
    cats[k] = cats[k].slice(0, perCategory)
  }
  return cats
}

export function parseRecommendText(content) {
  if (!content) return null
  let obj
  // Битый JSON не показываем официанту как есть (бывало «{"text":"…»).
  try { obj = JSON.parse(content) } catch { return typeof content === 'string' && !content.trim().startsWith('{') && content.trim() ? content.trim() : null }
  if (obj?.say) return composePitch(obj.offer, obj.say)
  const t = obj?.text ?? obj?.recommendation ?? null
  return typeof t === 'string' && t.trim() ? t.trim() : null
}

// ── ИИ-полировка фраз «коуча стола» ──────────────────────────────────────
// Коуч детерминированный (мгновенный, оффлайн). Здесь — необязательный слой:
// переписать ТОЛЬКО произносимую гостю реплику (то, что во внешних «…») теплее,
// живее и с учётом профиля/повода/предпочтений гостя. Директиву официанту и все
// числа/факты НЕ трогаем — они остаются из детерминированного текста. Реплики
// без чисел, поэтому модель ничего не выдумывает про время/суммы.

// Достаём произносимую реплику (в первых внешних «…») из текста сигнала.
export function extractQuote(text) {
  const m = /«([^»]*)»/.exec(text || '')
  return m ? m[1].trim() : null
}

export function buildCoachMessages({ signals, guest }) {
  // Кормим модель только тем, у чего есть реплика гостю (поле quote).
  const items = (signals || [])
    .map((s) => ({ id: s.id, situation: (s.text || '').trim(), draft: (s.quote || '').trim() }))
    .filter((s) => s.draft)
  const g = guest || {}
  const guestLine = [
    g.occasion && `повод: ${g.occasion}`,
    g.partySize ? `гостей за столом: ${g.partySize}` : null,
    g.preferences && `предпочтения/ограничения: ${g.preferences}`,
  ].filter(Boolean).join(', ') || 'не указан'

  const system = `Ты — наставник по сервису в ресторане. Официанту нужны короткие, живые, тёплые реплики, которые он ДОСЛОВНО скажет гостю. Для каждой ситуации перепиши черновик реплики естественнее и человечнее.
Правила:
- ТОЛЬКО сама произносимая фраза, 1 короткое предложение, без кавычек внутри;
- сохрани смысл черновика; НЕ добавляй чисел, цен, времени — их в реплике быть не должно;
- учитывай профиль гостя (повод, число гостей, предпочтения). Если у гостя есть ограничение (напр. «без чеснока», аллергия) — не предлагай то, что ему противоречит;
- при опоздании блюда — вежливо и без негатива к кухне («уже готовим, вынесем совсем скоро»), не оправдывайся долго;
- тон под повод: романтика — камернее, компания/праздник — легче и веселее.
Верни СТРОГО JSON: {"<id>":"<фраза без кавычек>"} — по одному ключу на каждый переданный id. Ничего лишнего.`

  const user = `Гость: ${guestLine}.
Ситуации (перепиши поле draft):
${JSON.stringify(items)}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// Разбор ответа: {id: "фраза"} → отбрасываем неизвестные id и пустое.
export function parseCoachPolish(content, ids) {
  if (!content) return null
  let obj
  try { obj = JSON.parse(content) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const allow = new Set(ids || [])
  const out = {}
  for (const [id, phrase] of Object.entries(obj)) {
    if (!allow.has(id)) continue
    if (typeof phrase !== 'string') continue
    // Модель могла обернуть в кавычки — снимаем внешние «…» / "…".
    const clean = phrase.trim().replace(/^[«"]+|[»"]+$/g, '').trim()
    if (clean) out[id] = clean
  }
  return Object.keys(out).length ? out : null
}

// Фолбэк без ИИ: короткая директива с готовой цитатой по самому
// приоритетному кандидату. Тот же стиль, что у ИИ.
export function templateSet(pools) {
  const all = [...(pools.main || []), ...(pools.alco || []), ...(pools.soft || []), ...(pools.dessert || [])]
  if (all.length === 0) return null
  all.sort((a, b) => scoreOf(b) - scoreOf(a))
  const best = all[0].name
  // Название в директиве — без кавычек; в «…» только произносимая фраза (её жирнит фронт).
  return `Предложите ${best}: «к вашему заказу хорошо подойдёт ${best} — принести?»`
}
