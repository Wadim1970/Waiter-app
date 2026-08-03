// AI-коуч официанта — ЧИСТАЯ логика (без БД и сети, поэтому юнит-тестируется).
// Детерминированный ранжировщик выбирает блюда-кандидаты для апсейла, а
// DeepSeek (в api/waiter/suggest.js) пишет «скрипт» — что сказать гостю. Здесь
// только правила выбора, бейджи, шаблонные подсказки и сборка/разбор промпта.

// Тег официанта → как отфильтровать меню. Регэкспы регистронезависимы (кириллица).
export const TAG_FILTERS = {
  'мясное':          /стейк|рибай|миньон|говядин|мяс|бургер|ребр|каре|ягн|утк|телятин|свин|кури|цыпл|шашлык/i,
  'рыбное':          /рыб|сёмг|семг|лосос|форел|креветк|устриц|мид|морепрод|тунец|краб|осьминог|дорад|сибас|угорь/i,
  'вегетарианское':  /салат|овощ|веган|вегетар|хумус|брускет|гриб|фалафел|рататуй/i,
  'десерт':          /десерт|торт|чизкейк|морож|тирамису|пирог|панакот|наполеон|штрудел|сырник/i,
}

export function matchesTag(item, tag) {
  if (!tag || tag === 'топ-совет') return true
  if (tag === 'бокал к столу') {
    return item.productType === 'alcohol' || /вино|бокал|игрист|просекко|шампан|аперол/i.test(item.name || '')
  }
  // «Дополнение» — то, что дополняет уже выбранное: напитки, десерты, гарниры,
  // соусы. Мясо/рыбу/основные блюда сюда НЕ берём (это не пара, а второе блюдо).
  if (tag === 'дополнение') {
    if (item.productType === 'drink' || item.productType === 'alcohol') return true
    return /напит|вино|бокал|сок|лимонад|коктейл|кофе|чай|раф|смузи|морс|компот|игрист|аперол|десерт|торт|морож|чизкейк|тирамису|панакот|штрудел|сырник|соус|гарнир/i
      .test(`${item.name || ''} ${item.section || ''}`)
  }
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

// Выбор кандидатов: доступные, не в стоп-листе (86), не исключённые, под тег.
export function rankCandidates(digest, { tag, exclude = [], limit = 3 } = {}) {
  const ex = new Set(exclude)
  return (digest || [])
    .filter(i => i.available && i.dailyFlag !== 'stop' && !ex.has(i.id) && matchesTag(i, tag))
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, Math.max(1, Math.min(Number(limit) || 3, 5)))
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
  const why = item.pushReason
    || (item.dailyFlag === 'expiring' ? 'сегодня последний день — предложите в первую очередь' : '')
  return `Предложите «${item.name}»${why ? ' — ' + why : ''}.`
}

// Сборка сообщений для DeepSeek. Кандидатам режем описание, чтобы промпт был
// коротким (скорость). Маржу/себестоимость модели не показываем — только «why».
export function buildMessages({ candidates, stage, tag, guest, cart }) {
  const menu = candidates.map(c => ({
    id: c.id,
    name: c.name,
    price: c.price,
    desc: (c.description || '').slice(0, 120),
    why: [
      c.pushReason,
      c.dailyFlag === 'expiring' ? 'последний день реализации' : null,
      c.dailyFlag === 'special' ? 'спец дня от шефа' : null,
    ].filter(Boolean).join('; ') || null,
  }))
  const g = guest || {}
  const guestLine = [
    g.gender && `пол: ${g.gender}`,
    g.age && `возраст: ${g.age}`,
    g.occasion && `повод: ${g.occasion}`,
  ].filter(Boolean).join(', ') || 'не указан'

  const system = `Ты — опытный наставник-официант и сомелье. Помогаешь официанту предложить гостю удачное дополнение и подсказываешь, ЧТО именно сказать — тепло, по-человечески, не впаривая.
Правила:
- рекомендуй ТОЛЬКО из списка кандидатов, по их id;
- учитывай профиль гостя (пол, возраст, повод) и стадию визита;
- если гость УЖЕ что-то выбрал (см. «Уже в заказе») — предлагай то, что СОЧЕТАЕТСЯ с выбранным (напиток, соус, гарнир, десерт), а не повторяет и не заменяет его;
- ОБЯЗАТЕЛЬНО обоснуй сочетание КОРОТКО и УБЕДИТЕЛЬНО: почему подходит именно к выбранному — по вкусу, сытности, свежести или температуре. Официант должен суметь это произнести дословно.
  Пример: «Вы выбрали сытные мясные блюда — освежит наш цитрусовый чизкейк, он лёгкий и не перегружает.» Или: «К стейку отлично подойдёт бокал красного — подчеркнёт вкус мяса.»;
- НИКОГДА не упоминай гостю маржу, себестоимость или выгоду ресторана;
- pitch — это и есть та живая обоснованная фраза (1–2 предложения), связывающая выбор гостя и предложение;
- addon — необязательная вторая пара (например, к десерту — кофе) или null.
Верни СТРОГО JSON: {"suggestions":[{"dishId":"<id>","pitch":"<обоснованная фраза, что сказать гостю>","addon":"<пара или null>"}]} — по одному объекту на каждого кандидата, в том же порядке.`

  const cartLine = Array.isArray(cart) && cart.length
    ? `\nУже в заказе у гостя: ${cart.join(', ')}.`
    : ''
  const user = `Стадия: ${stage || 'консультация'}. Тег/запрос: ${tag || 'общий совет'}. Гость: ${guestLine}.${cartLine}
Кандидаты (по убыванию приоритета):
${JSON.stringify(menu)}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// Разбор ответа DeepSeek. Отбрасываем всё, что не из набора кандидатов
// (защита от галлюцинаций id). null → вызвать шаблонный фолбэк.
export function parsePitches(content, candidates) {
  if (!content) return null
  let obj
  try { obj = JSON.parse(content) } catch { return null }
  const arr = Array.isArray(obj) ? obj : (obj.suggestions || obj.items || [])
  if (!Array.isArray(arr)) return null
  const ids = new Set(candidates.map(c => c.id))
  const out = arr
    .filter(x => x && ids.has(x.dishId) && typeof x.pitch === 'string' && x.pitch.trim())
    .map(x => ({
      dishId: x.dishId,
      pitch: x.pitch.trim(),
      addon: x.addon && String(x.addon).trim() && String(x.addon).trim().toLowerCase() !== 'null'
        ? String(x.addon).trim() : null,
    }))
  return out.length ? out : null
}

// ── Рекомендательный НАБОР (виджет «Подсказка от RestAI» на экране заказа) ──
// Не карточки, а один связный текст: по одному дополнению из подходящих
// категорий. Ниже — разбивка меню по категориям и промпт для набора.

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

// Промпт для единого текста-набора.
export function buildRecommendMessages({ cart, pools, guest }) {
  const compact = (arr) => (arr || []).map((c) => ({
    name: c.name,
    price: c.price,
    why: [
      c.pushReason,
      c.dailyFlag === 'expiring' ? 'последний день реализации' : null,
      c.dailyFlag === 'special' ? 'спец дня' : null,
    ].filter(Boolean).join('; ') || null,
  }))
  const menu = {
    основное: compact(pools.main),
    алкоголь: compact(pools.alco),
    безалкогольное: compact(pools.soft),
    десерт: compact(pools.dessert),
  }
  const g = guest || {}
  const guestLine = [g.gender && `пол: ${g.gender}`, g.age && `возраст: ${g.age}`]
    .filter(Boolean).join(', ') || 'не указан'

  const system = `Ты — наставник-официант и сомелье. Гость уже выбрал блюда. Составь ОДИН короткий связный совет официанту (3–5 предложений, живой текст) — какой оптимальный НАБОР предложить в дополнение: по одному из ПОДХОДЯЩИХ категорий (основное, напиток алкогольный, напиток безалкогольный, десерт).
Правила:
- бери ТОЛЬКО из предложенных кандидатов, по их названиям; не выдумывай блюд;
- для каждого — короткое УБЕДИТЕЛЬНОЕ обоснование сочетания по вкусу (подчёркивает / освежает / дополняет), связанное с выбором гостя;
- включай не все категории подряд, а только те, что реально уместны к заказу; не перегружай;
- у кандидатов есть пометки why (маржа/срок) — при равной уместности предпочитай их (это выгодно ресторану), но гостю про выгоду/маржу/себестоимость НЕ говори;
- пиши единым абзацем, как живую рекомендацию, которую официант произнесёт гостю.
Верни СТРОГО JSON: {"text":"<готовый совет одним абзацем>"}.`

  const user = `Гость выбрал: ${(cart || []).join(', ') || '—'}. Профиль гостя: ${guestLine}.
Кандидаты по категориям (по убыванию приоритета):
${JSON.stringify(menu)}`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

export function parseRecommendText(content) {
  if (!content) return null
  let obj
  try { obj = JSON.parse(content) } catch { return typeof content === 'string' && content.trim() ? content.trim() : null }
  const t = obj?.text ?? obj?.recommendation ?? null
  return typeof t === 'string' && t.trim() ? t.trim() : null
}

// Фолбэк без ИИ: детерминированный набор одним предложением.
export function templateSet(pools) {
  const first = (arr) => (arr && arr[0] ? arr[0].name : null)
  const parts = []
  if (first(pools.main)) parts.push(`из основного — «${first(pools.main)}»`)
  const drink = first(pools.alco) || first(pools.soft)
  if (drink) parts.push(`из напитков — «${drink}»`)
  if (first(pools.dessert)) parts.push(`на десерт — «${first(pools.dessert)}»`)
  if (parts.length === 0) return null
  return `К заказу хорошо подойдёт: ${parts.join(', ')}. Уточните у гостей, всё ли в порядке с заказом.`
}
