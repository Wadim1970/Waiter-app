// Совет к корзине гостя — ЧИСТАЯ логика (без БД и сети, node --test).
//
// Гость открыл корзину → смотрим, чего не хватает именно к ЭТОМУ приёму пищи:
//   ужин   — к стейку соус и гарнир, к горячему закуска или салат, напиток;
//   обед   — к горячему суп или салат, к супу горячее, напиток;
//   завтрак — напиток (кофе, чай, сок); стейки, супы и соусы к мясу — нет;
//   поздний вечер — к алкоголю закуска, к еде напиток.
// Совет — одно блюдо. Сначала из готовых пар («к этому блюду подойдёт» — там
// уже есть хорошая фраза), потом по роли блюда. Всё хватает — не советуем, а
// хвалим выбор и спрашиваем, можно ли позже предложить десерт.
//
// Нейросеть здесь не нужна: ответ мгновенный и не предложит то, чего нет.

import { roleOf, suitsMeal, mealOfCart, isFood, isDrink, MEAL_TO } from './mealCore.js'

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()

// Стейк, гриль, котлета, рыба на гриле — просят соус и гарнир.
const NEEDS_SAUCE_RE = /стейк|рибай|стриплойн|филе-миньон|медальон|шашлык|люля|гриль|котлет|колбаск|отбивн|шницел|эскалоп|куриц|цыпл|утк|свин|говяд|ягн|баран|телят|рыб|лосос|сибас|дорад|форел|судак|треск|креветк|пельмен|вареник|манты|хинкали|драник/
const HAS_SAUCE_RE = /соус|сметан|в сливках|сливочн|песто|карбонар|болоньез|терияки|барбекю|под /
const NEEDS_SIDE_RE = /стейк|рибай|стриплойн|филе-миньон|медальон|шашлык|люля|котлет|колбаск|отбивн|шницел|эскалоп|на гриле|гриль|утин|утка|цыплен|филе/
const HAS_SIDE_RE = /с картоф|с пюре|с рис|с овощ|с гарнир|с гречк|с булгур|с салат|с фри|с полент|с киноа|с кус-кус|с макарон|с пастой|со спаржей|с брокколи/
// К мясу и рыбе — «мясные» соусы, не десертные топпинги.
const MEAT_SAUCE_RE = /перечн|грибн|демиглас|барбекю|чимичурри|беарнез|сливочн|сырн|чесночн|горчичн|ткемали|сацебели|аджик|наршараб|тартар|соус|сметан/
const SWEET_RE = /карамел|шоколад|ягодн|варень|сгущ|кленов|мед(?![а-я])|медов/

// Цена допа относительно блюда, к которому его предлагаем.
function priceOk(gap, anchor, item) {
  const a = Number(anchor?.price) || 0
  const p = Number(item.price) || 0
  if (!p) return false
  if (gap === 'sauce' || gap === 'side') return p <= Math.max(a * 0.6, 400)
  if (gap === 'drink') return p <= Math.max(a * 0.9, 700)
  return p <= Math.max(a * 1.1, 900)
}

const lowerFirst = (s) => {
  const t = String(s || '')
  return /^[А-ЯЁ][а-яё]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t
}

// Короткое описание блюда для совета: первое предложение, до ~100 символов.
function shortWhy(item) {
  const d = String(item?.description || '').replace(/\s+/g, ' ').trim()
  if (!d) return null
  const first = d.split(/(?<=[.!?])\s/)[0]
  return first.length > 110 ? `${first.slice(0, 107).replace(/[\s,;:–—-]+\S*$/, '')}…` : first
}

const ROLES_BY_GAP = {
  sauce: ['sauce'],
  side: ['side'],
  soup: ['soup', 'salad'],
  main: ['main'],
  starter: ['salad', 'starter'],
  snack: ['starter', 'salad', 'bread'],
}
const DRINK_ROLES = {
  breakfast: ['hot_drink', 'soft'],
  lunch: ['soft', 'hot_drink', 'alco'],
  dinner: ['alco', 'soft'],
  late: ['alco', 'soft', 'hot_drink'],
}

// Что не хватает — по порядку важности для этого приёма пищи.
export function findGaps(lines, meal) {
  const roles = lines.map((l) => l.role)
  const has = (r) => roles.includes(r)
  const food = lines.filter((l) => isFood(l.role))
  const mains = lines.filter((l) => l.role === 'main')
  const firstFood = food.find((l) => l.isNew) || food[0] || null
  const gaps = []
  const sauceAndSide = () => {
    const meat = mains.find((m) => NEEDS_SAUCE_RE.test(norm(m.item.name)) && !HAS_SAUCE_RE.test(norm(`${m.item.name} ${m.item.description || ''}`)))
    if (meat && !has('sauce')) gaps.push({ gap: 'sauce', anchor: meat })
    const plain = mains.find((m) => NEEDS_SIDE_RE.test(norm(m.item.name)) && !HAS_SIDE_RE.test(norm(`${m.item.name} ${m.item.description || ''}`)))
    if (plain && !has('side')) gaps.push({ gap: 'side', anchor: plain })
  }
  const drink = () => {
    if (food.length && !roles.some(isDrink)) gaps.push({ gap: 'drink', anchor: mains[0] || firstFood, roles: DRINK_ROLES[meal] })
  }

  if (meal === 'breakfast') {
    drink()
  } else if (meal === 'lunch') {
    if (mains.length && !has('soup') && !has('salad') && !has('starter')) gaps.push({ gap: 'soup', anchor: mains[0] })
    if (has('soup') && !mains.length) gaps.push({ gap: 'main', anchor: lines.find((l) => l.role === 'soup') })
    sauceAndSide()
    drink()
  } else if (meal === 'dinner') {
    sauceAndSide()
    drink()
    if (mains.length && !has('salad') && !has('starter') && food.length <= 2) gaps.push({ gap: 'starter', anchor: mains[0] })
  } else {
    const alco = lines.find((l) => l.role === 'alco')
    if (alco && !food.length) gaps.push({ gap: 'snack', anchor: alco })
    drink()
  }
  return gaps
}

// Текст совета без готовой фразы пары.
function ruleText(gap, meal, anchor, item) {
  const a = anchor?.item?.name ? `«${anchor.item.name}»` : 'ваш заказ'
  const d = lowerFirst(item.name)
  switch (gap) {
    case 'sauce': return { title: `Вы выбрали ${a}`, text: `Хотим предложить к нему ${d} — он великолепно подчеркнёт вкус блюда.` }
    case 'side': return { title: `Гарнир к ${a}?`, text: `Предлагаем ${d} — отлично дополнит блюдо.` }
    case 'soup': return { title: 'Добавим на обед суп или салат?', text: `К ${a} отлично подойдёт ${d}.` }
    case 'main': return { title: 'Добавим горячее?', text: `После супа хорошо пойдёт ${d}.` }
    case 'starter': return { title: 'Начнём с закуски?', text: `Пока готовится ${a}, предлагаем ${d}.` }
    case 'snack': return { title: 'Что-нибудь к напитку?', text: `К ${a} отлично подойдёт ${d}.` }
    default: return { title: `Что-нибудь выпить ${MEAL_TO[meal]}?`, text: `Предлагаем ${d}.` }
  }
}

// Похвала выбора — без лишних слов; вопрос про десерт — если он уместен.
const PRAISE = ['Прекрасный выбор!', 'Отличный заказ!', 'Великолепный выбор!']
function praise(lines, meal, askDessert) {
  const seed = lines.reduce((s, l) => s + l.item.name.length, 0)
  const title = PRAISE[seed % PRAISE.length]
  const sweet = meal === 'breakfast' ? 'что-нибудь сладкое к завтраку' : `десерт ${MEAL_TO[meal]}`
  return {
    title,
    text: askDessert
      ? `У вас отличный вкус. Можно мы чуть позже предложим вам ${sweet}?`
      : 'У вас отличный вкус. Приятного аппетита!',
  }
}

/**
 * cart / ordered: [{id, quantity}] — в корзине и уже отправленное этим гостем;
 * menu: [{id, name, section, productType, price, description, available, stopped, priority, role?, mealTimes?}];
 * pairs: [{dish_id, pair_dish_id, lead, reason, source, rank}];
 * clockMeal — приём пищи по часам ресторана;
 * blocked(item) — гостю нельзя («не ем», аллергии);
 * dismissed: {dishes: Set<id>, gaps: Set<gap>} — уже отказался;
 * dessertAsked — про десерт уже спрашивали.
 */
export function adviseCart({ cart = [], ordered = [], menu = [], pairs = [], clockMeal, blocked = () => false, dismissed = {}, dessertAsked = false }) {
  const byId = new Map(menu.map((m) => [m.id, m]))
  const lines = [
    ...cart.map((c) => ({ ...c, isNew: true })),
    ...ordered.map((c) => ({ ...c, isNew: false })),
  ]
    .map((l) => ({ ...l, item: byId.get(l.id) }))
    .filter((l) => l.item)
    .map((l) => ({ ...l, role: roleOf(l.item) }))
  if (!lines.some((l) => l.isNew)) return { kind: 'none', meal: clockMeal }

  const meal = mealOfCart(lines.map((l) => l.role), clockMeal)
  const inCartNames = new Set(lines.map((l) => norm(l.item.name)))
  const inCart = new Set(lines.map((l) => l.id))
  const noDishes = dismissed.dishes || new Set()
  const noGaps = dismissed.gaps || new Set()

  const ok = (item, roles) => item
    && item.available !== false && !item.stopped
    && !inCart.has(item.id) && !inCartNames.has(norm(item.name))
    && !noDishes.has(item.id)
    && roles.includes(roleOf(item))
    && suitsMeal(item, meal)
    && !blocked(item)

  for (const g of findGaps(lines, meal)) {
    if (noGaps.has(g.gap)) continue
    const roles = g.roles || ROLES_BY_GAP[g.gap]
    const anchors = [g.anchor, ...lines.filter((l) => l !== g.anchor)].filter(Boolean)

    // 1) Готовые пары от блюд корзины: сначала к «своему» блюду, приоритетные первыми.
    const anchorRank = new Map(anchors.map((a, i) => [a.id, i]))
    const fromPairs = pairs
      .filter((p) => anchorRank.has(p.dish_id))
      .map((p) => ({ p, item: byId.get(p.pair_dish_id) }))
      .filter(({ p, item }) => ok(item, roles) && priceOk(g.gap, byId.get(p.dish_id), item))
      .sort((x, y) => anchorRank.get(x.p.dish_id) - anchorRank.get(y.p.dish_id)
        || (y.item.priority || 0) - (x.item.priority || 0)
        || (x.p.source === 'manual' ? 0 : 1) - (y.p.source === 'manual' ? 0 : 1)
        || (x.p.rank || 1) - (y.p.rank || 1))
    if (fromPairs.length) {
      const { p, item } = fromPairs[0]
      return {
        kind: 'suggest', meal, gap: g.gap, source: 'pairing',
        dish: { id: item.id, name: item.name, price: item.price }, anchorId: p.dish_id,
        title: p.lead, text: p.reason || shortWhy(item),
      }
    }

    // 2) По роли: соус — только «мясной», напиток — подешевле, приоритетные первыми.
    const pool = menu
      .filter((item) => ok(item, roles) && priceOk(g.gap, g.anchor?.item, item))
      // Соус к мясу — «мясной» по названию или отмечен соусом вручную; сладкий — никогда.
      .filter((item) => g.gap !== 'sauce' || ((item.role === 'sauce' || MEAT_SAUCE_RE.test(norm(item.name))) && !SWEET_RE.test(norm(item.name))))
      .sort((x, y) => (y.priority || 0) - (x.priority || 0)
        || roles.indexOf(roleOf(x)) - roles.indexOf(roleOf(y))
        || (g.gap === 'drink' ? (x.price || 0) - (y.price || 0) : 0)
        || String(x.name).localeCompare(String(y.name), 'ru'))
    if (pool.length) {
      const item = pool[0]
      const t = ruleText(g.gap, meal, g.anchor, item)
      return {
        kind: 'suggest', meal, gap: g.gap, source: 'rule',
        dish: { id: item.id, name: item.name, price: item.price }, anchorId: g.anchor?.id || null,
        title: t.title, text: [t.text, shortWhy(item)].filter(Boolean).join(' '),
      }
    }
  }

  // Всё на месте (или дополнить нечем) — хвалим. Про десерт спрашиваем, если
  // его ещё нет в заказе, он есть в меню и про него ещё не спрашивали.
  if (!lines.some((l) => isFood(l.role) || l.role === 'dessert')) return { kind: 'none', meal }
  const hasDessert = lines.some((l) => l.role === 'dessert')
  const dessertInMenu = menu.some((m) => m.available !== false && !m.stopped && roleOf(m) === 'dessert' && suitsMeal(m, meal) && !blocked(m))
  const askDessert = !dessertAsked && !hasDessert && dessertInMenu
  return { kind: 'complete', meal, askDessert, ...praise(lines, meal, askDessert) }
}

// Десерты к напоминанию: уместные сейчас, доступные, без «не ем», приоритетные первыми.
export function dessertPicks(menu, meal, blocked = () => false, limit = 3) {
  const seen = new Set()
  return menu
    .filter((m) => m.available !== false && !m.stopped && roleOf(m) === 'dessert' && suitsMeal(m, meal) && !blocked(m))
    .sort((x, y) => (y.priority || 0) - (x.priority || 0) || String(x.name).localeCompare(String(y.name), 'ru'))
    .filter((m) => { const k = norm(m.name); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, limit)
    .map((m) => ({ id: m.id, name: m.name, price: m.price, why: shortWhy(m) }))
}

// Когда напомнить о десерте: горячее у гостя готово — через 20 минут после
// этого; горячее ещё готовится — ждём (но не дольше 90 минут от согласия);
// заказанной еды не видно — через 40 минут после согласия.
export const DESSERT_AFTER_READY_MIN = 20
export const DESSERT_FALLBACK_MIN = 40
const DESSERT_MAX_WAIT_MIN = 90

export function dessertDueAt({ consentAt, food = [] }) {
  const start = new Date(consentAt).getTime()
  if (!food.length) return new Date(start + DESSERT_FALLBACK_MIN * 60000)
  const ready = food.map((f) => (f.readyAt ? new Date(f.readyAt).getTime() : null))
  if (ready.every((t) => t != null)) {
    return new Date(Math.max(start, ...ready) + DESSERT_AFTER_READY_MIN * 60000)
  }
  return new Date(start + DESSERT_MAX_WAIT_MIN * 60000)
}
