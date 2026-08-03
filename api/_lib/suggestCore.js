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

  const system = `Ты — опытный наставник-официант. Помогаешь официанту предложить гостю блюдо и подсказываешь, ЧТО именно сказать — тепло, по-человечески, не впаривая.
Правила:
- рекомендуй ТОЛЬКО из списка кандидатов, по их id;
- учитывай профиль гостя (пол, возраст, повод) и стадию визита;
- если гость УЖЕ что-то выбрал (см. «Уже в заказе») — предлагай то, что ДОПОЛНЯЕТ выбранное (напиток, соус, гарнир, десерт), а не повторяет его;
- НИКОГДА не упоминай гостю маржу, себестоимость или выгоду ресторана;
- pitch — это короткая живая фраза (1–2 предложения), которую официант скажет гостю;
- addon — необязательная пара к блюду (бокал вина, соус, гарнир) или null.
Верни СТРОГО JSON: {"suggestions":[{"dishId":"<id>","pitch":"<что сказать гостю>","addon":"<пара или null>"}]} — по одному объекту на каждого кандидата, в том же порядке.`

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
