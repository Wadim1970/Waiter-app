// Пары блюд для гостевого меню («к пицце Пепперони отлично подходит салат с
// бурратой») — ЧИСТАЯ логика (без БД и сети, проверяется node --test).
//
// Схема:
//   1) раз в сутки / при изменении меню нейросеть составляет пары по всему меню
//      (buildGenerateMessages → parseGenerated → validatePair) — их хранит
//      таблица menu_pairings, гостевое /api/menu отдаёт их вместе с блюдами;
//   2) когда гость открывает меню, /api/guest/pairings подбирает пары под него:
//      сначала СТРОГИЙ фильтр по «не ем»/аллергиям (dislikeMatcher — без
//      нейросети: ошибиться с аллергией нельзя), потом один запрос к ИИ —
//      выбрать лучшую пару под вкусы и переписать фразу (buildPersonalMessages).

import { categoryOf } from './suggestCore.js'

// Разделы, которые не участвуют в парах: «Лавка» — сыры и продукты навынос,
// не к столу; комбо — уже готовый набор.
const SKIP_SECTION_RE = /лавк|комбо|навынос|с собой/i
// Разделы, которые не бывают «основой» пары: соус сам по себе не заказывают,
// его добавляют к блюду.
const SAUCE_RE = /соус/i
const KIDS_RE = /детск/i
// Закуски к алкоголю: «к вину — сырная тарелка», «к пиву — брускетты».
const SNACK_RE = /закуск|салат|сыр|фокачч|брускетт|антипаст|тарелк|паштет|хумус|тартар|карпаччо|оливк|орех|чипс|гренк/i
// Крепкий алкоголь: к нему уместен безалкогольный миксер (джин — тоник).
const SPIRIT_RE = /джин|виски|ром\b|водк|текил|коньяк|бренди|кальвадос/i
const GARNISH_RE = /гарнир/i
const LENT_RE = /пост/i

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е')

// Алкоголь в подсказках не предлагаем: на алкоголь в приложении проверка
// возраста, и навязывать его подсказкой не стоит.
export function isAlcoholItem(item) {
  return item.productType === 'alcohol'
}

const isSoftDrink = (item) => item.productType === 'drink'
const isSauce = (item) => SAUCE_RE.test(item.section || '')
const isFood = (item) => !item.productType || item.productType === 'food'

// Основа пары — то, после чего гостю показываем подсказку. Соус сам по
// себе не заказывают, а к лимонаду, соку или кофе подсказка не нужна
// (иначе «к мохито — аджика»).
export function canBeAnchor(item) {
  return item.available !== false
    && Number(item.price) > 0
    && !SKIP_SECTION_RE.test(item.section || '')
    && !isSauce(item)
    && !isSoftDrink(item)
}

export function canBePair(item) {
  return item.available !== false
    && Number(item.price) > 0
    && !SKIP_SECTION_RE.test(item.section || '')
    && !isAlcoholItem(item)
}

// Правила, которые пара обязана выполнять независимо от того, что ответила
// нейросеть. Возвращает null, если пара годится, иначе причину отказа.
export function pairRejectReason(anchor, pair) {
  if (!anchor || !pair) return 'missing'
  if (anchor.id === pair.id) return 'same'
  if (!canBeAnchor(anchor)) return 'anchor'
  if (!canBePair(pair)) return 'pair'
  // Из другого раздела: к пицце не предлагаем ещё одну пиццу.
  if (norm(anchor.section) === norm(pair.section)) return 'section'
  // Два основных блюда не конкурируют (пицца и стейк вместе не берут).
  if (categoryOf(anchor) === 'main' && categoryOf(pair) === 'main') return 'main'
  // Пара — дополнение, заметно не дороже основного (до +25%). Для недорогих блюд (кофе,
  // лимонад) допускаем пару до 500 ₽: «к кофе — тирамису» уместно.
  if (Number(pair.price) > Math.max((Number(anchor.price) || 0) * 1.25, 500)) return 'price'
  if (KIDS_RE.test(anchor.section || '') && isAlcoholItem(pair)) return 'kids'
  // Соус — только к еде, и не к десерту.
  if (isSauce(pair) && (!isFood(anchor) || categoryOf(anchor) === 'dessert')) return 'sauce'
  // К десерту — только напиток (кофе, чай, морс).
  if (categoryOf(anchor) === 'dessert' && !isSoftDrink(pair)) return 'dessert'
  // К алкоголю — закуска, сыр или салат; к крепкому ещё и безалкогольный
  // миксер. Не горячее, не десерт, не соус.
  // Гарнир — только к горячему (не «картофельное пюре к винегрету»).
  if (GARNISH_RE.test(pair.section || '') && categoryOf(anchor) !== 'main') return 'garnish'
  // К постному блюду — только постное: без мяса, рыбы, молочного и яиц
  // (не «сметана к постным вареникам»).
  if (LENT_RE.test(anchor.section || '') && !LENT_RE.test(pair.section || '') && leanBreaker()(pair)) return 'lent'
  if (isAlcoholItem(anchor)) {
    const mixer = isSoftDrink(pair) && SPIRIT_RE.test(anchor.name || '')
    const snack = isFood(pair) && !isSauce(pair) && categoryOf(pair) !== 'main' && categoryOf(pair) !== 'dessert'
      && SNACK_RE.test(`${pair.name || ''} ${pair.section || ''}`)
    if (!mixer && !snack) return 'alcohol'
  }
  return null
}

let leanMatcher = null
// Ленивая инициализация: dislikeMatcher объявлен ниже по файлу.
function leanBreaker() {
  return (leanMatcher ||= dislikeMatcher('вегетарианец, молоко, яйца'))
}

// Корень первого значимого слова названия: «Коньяк Napoleon» → «конь»,
// «Пицца Пепперони» → «пицц». Для проверки, о каком блюде заголовок.
function nameStem(name) {
  const word = norm(name).replace(/[«»"'()]/g, ' ').split(/[^а-яa-z]+/).find((w) => w.length >= 4)
  return word ? word.slice(0, Math.max(4, word.length - 2)) : null
}

// Заголовок должен говорить о блюде гостя первым: «К пицце Пепперони
// подходит салат», а не «К салату подходит пицца». Нейросеть иногда путает
// направление («К паштету подходит коньяк» для коньяка). Если оба названия
// нашлись и пара упомянута раньше — заголовок перевёрнут.
export function leadIsReversed(lead, anchorName, pairName) {
  const a = nameStem(anchorName), p = nameStem(pairName)
  if (!a || !p || a === p) return false
  const text = norm(lead)
  const pos = (stem) => {
    const m = new RegExp(`(^|[^а-яa-z])${stem}`).exec(text)
    return m ? m.index : -1
  }
  const ai = pos(a), pi = pos(p)
  return ai >= 0 && pi >= 0 && pi < ai
}

// Разнообразие: одно и то же блюдо — пара не больше чем к max блюдам меню
// (иначе «Зелёный салат» и «Мохитино» ко всему горячему). Запасные пары
// (rank 2–3) уступают место первым; после отсева rank пересчитывается и у
// блюда остаётся не больше perAnchor пар.
export function capPairUsage(generated, max = 6, perAnchor = 2) {
  const used = new Map()
  const kept = []
  const ordered = [...generated].sort((a, b) => a.rank - b.rank)
  for (const g of ordered) {
    const n = used.get(g.pairId) || 0
    if (n >= max) continue
    used.set(g.pairId, n + 1)
    kept.push(g)
  }
  const ranks = new Map()
  return generated.filter((g) => kept.includes(g)).map((g) => {
    const r = (ranks.get(g.anchorId) || 0) + 1
    ranks.set(g.anchorId, r)
    return { ...g, rank: r }
  }).filter((g) => g.rank <= perAnchor)
}

// Компактный слепок меню для промпта и стабильный хэш меню. Номера вместо
// uuid: короче промпт и модель не «выдумывает» похожие id.
export function compactMenu(items) {
  return items.map((it, i) => ({
    n: i + 1,
    name: it.name,
    section: it.section,
    price: Number(it.price) || 0,
    desc: String(it.description || '').replace(/\s+/g, ' ').slice(0, 90),
  }))
}

export function menuFingerprint(items) {
  return [...items]
    .map((it) => [it.id, it.name, it.section, Number(it.price) || 0, it.available !== false ? 1 : 0].join('|'))
    .sort()
    .join('\n')
}

// Промпт пачки: весь список блюд (из него выбираются пары) + номера блюд,
// для которых нужно подобрать пары в этом запросе.
export function buildGenerateMessages({ menu, anchorNumbers, restaurantName }) {
  const system = `Ты — шеф-повар и сомелье ресторана${restaurantName ? ` «${restaurantName}»` : ''}. Для блюд, которые гость кладёт в заказ, ты подбираешь ПАРУ — одно блюдо из меню, которое отлично его дополнит. Гость увидит подсказку сразу после добавления блюда в корзину.

Правила подбора:
- пара из ДРУГОГО раздела меню: к пицце — салат, закуска, напиток или десерт, но не другая пицца;
- два основных горячих блюда вместе не предлагай (пицца + стейк — нет);
- пара сочетается по вкусу, сытности, температуре и свежести: к жирному и сытному — свежее и лёгкое, к острому — сливочное или освежающее, к кофе — десерт, к десерту — кофе или чай;
- пара не дороже основного блюда больше чем на четверть (кроме случаев, когда основное стоит меньше 500 ₽);
- алкоголь не предлагай; к детскому меню — только детское уместное (соки, морсы, десерты);
- к безалкогольным напиткам пары не подбираются — их нет в списке блюд для подбора;
- к алкоголю — только закуска, сыр или салат («к вину — сырная тарелка»); к крепкому (джин, виски, ром) можно безалкогольный миксер (тоник);
- к десерту — только напиток: кофе, чай, морс;
- гарниры (пюре, картофель, рис) — только к горячим блюдам, не к салатам и закускам;
- к блюдам постного меню — только постное: без мяса, рыбы, молочного (сметана, сыр, сливки) и яиц;
- соусы предлагай только к еде, которую в них действительно макают или поливают (картофель фри, мясо, хлеб, пицца) — никогда к напиткам и десертам;
- разнообразь: не предлагай одно и то же блюдо ко всему подряд, подбирай пару под конкретный вкус каждого блюда;
- если к блюду ничего хорошего не подходит — не придумывай, пропусти его;
- на одно блюдо 2–3 РАЗНЫЕ пары, лучшую первой: если первую уже часто предлагают к другим блюдам, гостю покажут следующую.

Для каждой пары напиши два текста ДЛЯ ГОСТЯ, по-русски, без цен и чисел:
- lead — короткий заголовок до 70 символов, с названиями обоих блюд в правильных падежах. Начинается с блюда, которое гость УЖЕ положил в заказ (номер a), а пара (номер p) — после: «К пицце Пепперони отлично подходит салат с бурратой». Не наоборот;
- why — почему это вкусно вместе, до 90 символов, конкретно про вкус: «Сливочная буррата и свежие томаты смягчат остроту колбасок».
Пиши тепло и просто, как шеф советует гостю. Без восклицательных знаков, без слов «идеально», «шедевр», «незабываемо».

Ответ — СТРОГО JSON: {"pairs":[{"a":<номер блюда>,"p":<номер пары>,"lead":"...","why":"..."}]}. Номера — только из списка меню.`

  const user = `Меню (номер, название, раздел, цена, описание):
${JSON.stringify(menu)}

Подбери пары для блюд с номерами: ${anchorNumbers.join(', ')}.`

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

function clipText(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim().replace(/^[«"']+|[»"']+$/g, '')
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

// Разбор ответа генерации → [{anchorId, pairId, lead, why}]. Всё, что нарушает
// правила (pairRejectReason) или ссылается на чужие номера, отбрасываем.
// Не больше 2 пар на блюдо, без дублей.
// stats (необязательно) — счётчики для лога: сколько пар предложила модель и
// по какому правилу отсеяна каждая; по ним видно, какое правило режет лишнее.
export function parseGenerated(content, items, anchorNumbers, stats = {}) {
  const bump = (k) => { stats[k] = (stats[k] || 0) + 1 }
  let obj
  try { obj = JSON.parse(content) } catch { bump('badJson'); return [] }
  const arr = Array.isArray(obj) ? obj : obj?.pairs
  if (!Array.isArray(arr)) { bump('badJson'); return [] }
  const allowedAnchors = new Set(anchorNumbers)
  const perAnchor = new Map()
  const out = []
  for (const x of arr) {
    bump('proposed')
    const a = Number(x?.a), p = Number(x?.p)
    if (!allowedAnchors.has(a)) { bump('foreignAnchor'); continue }
    const anchor = items[a - 1], pair = items[p - 1]
    const reason = pairRejectReason(anchor, pair)
    if (reason) { bump(reason); continue }
    const lead = clipText(x.lead, 90)
    const why = clipText(x.why, 120)
    if (!lead || !why) { bump('noText'); continue }
    if (leadIsReversed(lead, anchor.name, pair.name)) { bump('leadOrder'); continue }
    const list = perAnchor.get(anchor.id) || []
    if (list.length >= 3 || list.includes(pair.id)) { bump('extra'); continue }
    list.push(pair.id)
    perAnchor.set(anchor.id, list)
    out.push({ anchorId: anchor.id, pairId: pair.id, rank: list.length, lead, why })
    bump('kept')
  }
  return out
}

export function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ── «Не ем» и аллергии: строгий фильтр без нейросети ──

// Общие слова гостя → что искать в названии, описании и составе блюда.
const DISLIKE_GROUPS = [
  { re: /орех|арахис/, words: ['орех', 'арахис', 'фундук', 'миндал', 'кешью', 'фисташ', 'пекан', 'грецк', 'кедров', 'макадам', 'пралине', 'нутелл'] },
  { re: /вегет|не ем мяс|без мяс|мясо/, words: ['мяс', 'говяд', 'свин', 'куриц', 'курин', 'курят', 'цыпл', 'бекон', 'ветчин', 'колбас', 'пепперони', 'фарш', 'утк', 'утин', 'индейк', 'ягн', 'баран', 'телят', 'салями', 'хамон', 'прошутто', 'сало', 'бульон', 'котлет', 'стейк', 'буженин', 'ростбиф'] },
  { re: /вегет|рыб/, words: ['рыб', 'лосос', 'семг', 'форел', 'тунец', 'треск', 'судак', 'сибас', 'дорад', 'скумбри', 'анчоус', 'сельд', 'икр'] },
  { re: /вегет|морепрод|креветк|кальмар|мид/, words: ['кревет', 'кальмар', 'миди', 'осьминог', 'краб', 'гребеш', 'устриц', 'морепрод', 'лангустин'] },
  { re: /лактоз|молок|молоч/, words: ['молок', 'молоч', 'сливк', 'сливоч', 'сыр', 'сметан', 'йогурт', 'творог', 'моцарел', 'пармезан', 'буррат', 'маскарпоне', 'рикотт', 'кефир', 'мороженое', 'латте', 'капучино', 'раф'] },
  { re: /глютен|пшениц|мук/, words: ['мук', 'пшениц', 'хлеб', 'тесто', 'паст', 'спагетти', 'лапш', 'пицц', 'фокачч', 'брускетт', 'гренк', 'сухар', 'булк', 'блин', 'панировк', 'кляр'] },
  { re: /остр/, words: ['остр', 'чили', 'халапеньо', 'табаско', 'шрирач', 'аджик', 'пепперони'] },
  { re: /яйц|яиц/, words: ['яйц', 'яиц', 'омлет', 'майонез', 'глазунь'] },
  { re: /гриб/, words: ['гриб', 'шампиньон', 'вешенк', 'трюфел', 'опят', 'лисичк'] },
  { re: /сахар|сладк|диабет/, words: ['десерт', 'торт', 'сахар', 'сироп', 'мед', 'шоколад', 'карамел', 'варенье', 'лимонад'] },
]

const STOP_WORDS = new Set(['не', 'ем', 'люблю', 'без', 'аллергия', 'на', 'и', 'или', 'а', 'также', 'тоже', 'очень', 'совсем', 'пожалуйста', 'нельзя', 'никакой', 'никаких', 'никакие', 'есть'])

// Корень слова для поиска: «помидоры» → «помидо», «кинза» → «кинз». Короткие
// слова (до 4 букв) ищем целиком.
function stemOf(word) {
  if (word.length <= 4) return word
  return word.slice(0, Math.max(4, word.length - 2))
}

// Текст «Что вы не едите» → функция (блюдо) → true, если блюдо гостю нельзя.
export function dislikeMatcher(dislikes) {
  const text = norm(dislikes)
  if (!text.trim()) return () => false
  const roots = new Set()
  for (const g of DISLIKE_GROUPS) {
    if (g.re.test(text)) g.words.forEach((w) => roots.add(w))
  }
  for (const raw of text.split(/[,;\n.]+|\s+и\s+/)) {
    for (const w of raw.split(/[^а-яa-z-]+/)) {
      if (w.length < 3 || STOP_WORDS.has(w)) continue
      roots.add(stemOf(w))
    }
  }
  const noAlcohol = /алкогол|не пью|спиртн/.test(text)
  // Корень ищем с НАЧАЛА слова: иначе «мид» (мидии) находится в «помидорах».
  const list = [...roots].map((r) => r.replace(/[^а-яa-z-]/g, '')).filter(Boolean)
  const re = list.length ? new RegExp(`(^|[^а-яa-z])(${list.join('|')})`) : null
  return (item) => {
    if (noAlcohol && item.productType === 'alcohol') return true
    if (!re) return false
    const hay = norm([item.name, item.description, ...(Array.isArray(item.ingredients) ? item.ingredients : [])].join(' '))
      // «куриное яйцо» — это яйцо, а не курица: вегетарианцу подходит.
      .replace(/курин[а-я]*\s+яй[а-я]*|яй[а-я]*\s+курин[а-я]*/g, 'яйцо')
    return re.test(hay)
  }
}

// ── Подбор под конкретного гостя ──

// Профиль гостя для промпта: что не ест + что обычно заказывает (из истории
// оплаченных заказов, guests.preferences).
export function guestTasteLine({ dislikes, history }) {
  const parts = []
  if (dislikes && String(dislikes).trim()) parts.push(`не ест: ${String(dislikes).trim().slice(0, 200)}`)
  const top = (history?.top_dishes || []).map((d) => d.name).filter(Boolean).slice(0, 5)
  if (top.length) parts.push(`часто заказывает: ${top.join(', ')}`)
  const sections = Object.keys(history?.sections || {}).slice(0, 4)
  if (sections.length) parts.push(`любимые разделы: ${sections.join(', ')}`)
  return parts.join('; ')
}

// anchors: [{n, name, options:[{n, name, why}]}] — уже ПОСЛЕ строгого фильтра.
export function buildPersonalMessages({ anchors, taste }) {
  const system = `Ты — шеф ресторана. Гость открыл меню. Для каждого блюда ниже уже подобраны 1–3 варианта пары (что предложить, когда гость положит это блюдо в заказ). Выбери для каждого блюда ОДИН лучший вариант с учётом вкусов гостя.

Если вкус гостя прямо связан с выбранной парой (любит сливочное, часто берёт лимонады, любит острое и т. п.) — перепиши why коротко и лично, до 90 символов: «Вы часто берёте лимонады — этот с мятой освежит после пиццы». Если связи нет — why не пиши, оставится исходный текст. Не упоминай то, что гость не ест. Без цен и чисел.

Ответ — СТРОГО JSON: {"picks":[{"a":<номер блюда>,"p":<номер выбранной пары>,"why":"<личный текст или пусто>"}]}.`
  const user = `Гость: ${taste || 'без особых предпочтений'}.
Блюда и варианты пар:
${JSON.stringify(anchors)}`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// Разбор ответа подбора → Map(anchorN → {p, why}). Номер пары должен быть
// одним из вариантов этого блюда.
export function parsePersonal(content, anchors) {
  let obj
  try { obj = JSON.parse(content) } catch { return new Map() }
  const arr = Array.isArray(obj) ? obj : obj?.picks
  const out = new Map()
  if (!Array.isArray(arr)) return out
  const byN = new Map(anchors.map((a) => [a.n, a]))
  for (const x of arr) {
    const a = byN.get(Number(x?.a))
    if (!a) continue
    const opt = a.options.find((o) => o.n === Number(x?.p))
    if (!opt) continue
    out.set(a.n, { p: opt.n, why: clipText(x.why, 120) || null })
  }
  return out
}
