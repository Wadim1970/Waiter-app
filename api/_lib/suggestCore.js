// AI-коуч официанта — ЧИСТАЯ логика (без БД и сети, поэтому юнит-тестируется).
// Детерминированный ранжировщик выбирает блюда-кандидаты для апсейла, а
// DeepSeek (в api/waiter/suggest.js) пишет «скрипт» — что сказать гостю. Здесь
// только правила выбора, бейджи, шаблонные подсказки и сборка/разбор промпта.

// Тег официанта → как отфильтровать меню. Регэкспы регистронезависимы (кириллица).
// Секционные теги (еда). Напитки и алкоголь — отдельные ветки в matchesTag.
export const TAG_FILTERS = {
  'супы':          /суп|похлёбк|похлебк|борщ|уха|солянк|бульон|том\s?ям|рамен|крем-?суп|гаспачо/i,
  'мясо':          /стейк|рибай|миньон|говядин|мяс|бургер|ребр|каре|ягн|утк|телятин|свин|кури|цыпл|шашлык|котлет|бефстроганов|вырезк|окорок/i,
  'рыба':          /рыб|сёмг|семг|лосос|форел|дорад|сибас|тунец|угорь|треск|судак|палтус|окун|скумбри|карп/i,
  'морепродукты':  /креветк|устриц|мид|краб|осьминог|кальмар|гребешок|морепрод|лангустин|каракатиц|лобстер|раки/i,
  'десерты':       /десерт|торт|чизкейк|морож|тирамису|пирог|панакот|наполеон|штрудел|сырник|крем-?брюле|мусс|эклер|макарон/i,
}

const DRINK_RE = /напит|сок|лимонад|коктейл|кофе|чай|раф|смузи|морс|компот|тоник|вода|милкшейк|какао|эспрессо|капучино|латте/i
const ALCO_RE  = /вино|бокал|игрист|просекко|шампан|виски|коньяк|аперол|пиво|ром\b|текил|джин|ликёр|ликер|вермут|портвейн|наливк|глинтвейн|сидр|виск/i

function isAlcohol(item) {
  return item.productType === 'alcohol' || ALCO_RE.test(`${item.name || ''} ${item.section || ''}`)
}
function isDrink(item) {
  return item.productType === 'drink' || DRINK_RE.test(`${item.name || ''} ${item.section || ''}`)
}

export function matchesTag(item, tag) {
  // ХИТ (тег по умолчанию) — ТОЛЬКО ЕДА: лучшие сочетания к уже выбранному,
  // приоритет по марже/списанию. Напитки и алкоголь сюда НЕ попадают —
  // их официант получает лишь по явному тегу «напитки»/«алкоголь».
  if (!tag || tag === 'хит') return !isDrink(item) && !isAlcohol(item)
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
    g.partySize ? `гостей за столом: ${g.partySize}` : null,
  ].filter(Boolean).join(', ') || 'не указан'

  const system = `Ты — опытный наставник-официант и сомелье. Помогаешь официанту предложить гостю удачное дополнение и подсказываешь, ЧТО именно сказать — тепло, по-человечески, не впаривая.
Правила:
- рекомендуй ТОЛЬКО из списка кандидатов, по их id;
- учитывай профиль гостя (пол, возраст, повод, число гостей) и стадию визита;
- соизмеряй с ЧИСЛОМ ГОСТЕЙ за столом: НЕ предлагай «две пиццы и две колы», если гость один — количество и набор под размер компании; для одного гостя — одиночные порции;
- учитывай ПОВОД (один, романтическая встреча, деловая встреча, семья, дружеская компания, праздник) и подбирай уместное под него;
- если гость УЖЕ что-то выбрал (см. «Уже в заказе») — предлагай из кандидатов то, что СОЧЕТАЕТСЯ с выбранным (по вкусу, сытности, свежести, температуре), а не повторяет и не заменяет его;
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

  const system = `Ты — наставник по продажам в ресторане и сомелье. Гость уже сделал заказ. Дай официанту ОДНУ короткую ДИРЕКТИВНУЮ подсказку: что предложить в дополнение и КАК это сказать.
Что предлагать — выбирай так:
1) сначала по ВКУСУ — что лучше всего сочетается с уже выбранными блюдами (подчёркивает / освежает / дополняет);
2) при близких по вкусу вариантах — предпочитай выгодные ресторану (у кандидатов есть пометка why: маржа/срок реализации), но гостю про выгоду/маржу/себестоимость НИКОГДА не говори.
Бери ТОЛЬКО из предложенных кандидатов, по их точным названиям; не выдумывай.
Формат ответа — СТРОГО 1–2 предложения:
- сначала короткая директива официанту (что предложить). Названия блюд в директиве пиши БЕЗ кавычек;
- затем ГОТОВАЯ ПРЯМАЯ ЦИТАТА — дословно, что официант говорит гостю, приёмом продаж. Возьми её в кавычки «…» — ровно ОДНИ внешние кавычки на всю фразу, внутри кавычек больше НЕ ставь (в приложении текст в «…» выделяется жирным, поэтому туда должна попасть ТОЛЬКО произносимая фраза):
   • выбор без выбора — «что принести к десерту — чай или кофе?»;
   • социальное доказательство — «сегодня гости особенно хвалят наш наполеон»;
   • вкусовое сочетание — «к вашему стейку идеально подойдёт бокал каберне»;
   • срочность — «осталась последняя порция чизкейка».
Выбери ОДИН, самый уместный приём. Цитата — живая и конкретная, с названием блюда. Без воды и без перечисления всех категорий.
Верни СТРОГО JSON: {"text":"<директива без кавычек + «фраза в кавычках», 1–2 предложения>"}.`

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

// Фолбэк без ИИ: короткая директива с готовой цитатой (социальное
// доказательство) по самому приоритетному кандидату. Тот же стиль, что у ИИ.
export function templateSet(pools) {
  const all = [...(pools.main || []), ...(pools.alco || []), ...(pools.soft || []), ...(pools.dessert || [])]
  if (all.length === 0) return null
  all.sort((a, b) => scoreOf(b) - scoreOf(a))
  const best = all[0].name
  // Название в директиве — без кавычек; в «…» только произносимая фраза (её жирнит фронт).
  return `Предложите ${best}: «Сегодня гости особенно хвалят ${best} — принести к заказу?»`
}
