// Раздел «Меню» в админке — ЧИСТАЯ логика: блюдо из строки БД для админки
// и обратно (проверка формы), разделы гостевого меню, копии в «Популярном».
//
// Раздел для гостя — текст menu_section, порядок разделов — section_order
// (гостевое меню сортирует по нему, внутри раздела — по названию). Приложение
// официанта показывает то же меню деревом: menu_sections (Еда, Напитки…) →
// menu_subsections → menu_sub_subsections; у блюда — section_id/subsection_id/
// sub_subsection_id («место у официанта»).

import { AROMA_KEY, GRAPE_KEY, VINTAGE_KEY } from './drinkProfile.js'

export const PRODUCT_TYPES = ['food', 'drink', 'alcohol']
export const COURSE_ROLES = ['breakfast', 'soup', 'salad', 'starter', 'main', 'side', 'sauce', 'bread', 'soft', 'hot_drink', 'alco', 'dessert', 'other']
export const MEAL_TIMES = ['breakfast', 'lunch', 'dinner', 'late']
export const WEIGHT_UNITS = ['г', 'мл', 'шт', 'кг', 'л']

const KBJU = [['kcal', 'calories_kcal'], ['protein', 'protein_g'], ['fat', 'fat_g'], ['carbs', 'carbs_g']]
const FOOD_KEYS = new Set(['calories_kcal', 'protein_g', 'fat_g', 'carbs_g', 'weight_value', 'weight_unit'])
// Старые КБЖУ без единиц (calories, fat…) и поля вина, у которых в форме
// свои поля, — не «прочие свойства».
const NOT_SPECS = new Set([...FOOD_KEYS, 'calories', 'protein', 'fat', 'carbs', AROMA_KEY, GRAPE_KEY, VINTAGE_KEY])

export const POPULAR = 'популярное'
export const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')
export const isPopular = (section) => norm(section) === POPULAR

function bad(message) {
  const e = new Error(message)
  e.status = 400
  return e
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v))

// Вес/объём: в данных бывает specific_details {weight_value, weight_unit},
// строка «500 мл» там же, или weight_g «/ 510 г.» / «500».
export function parseWeight(row) {
  const d = row.specific_details
  if (d && typeof d === 'object' && num(d.weight_value) != null) return { value: num(d.weight_value), unit: d.weight_unit || 'г' }
  const text = typeof d === 'string' && d.trim() ? d : row.weight_g
  const m = String(text || '').replace(/ /g, ' ').match(/(\d+(?:[.,]\d+)?)\s*([a-zа-я]*)/i)
  if (!m) return null
  const unit = m[2].toLowerCase()
  return { value: Number(m[1].replace(',', '.')), unit: WEIGHT_UNITS.includes(unit) ? unit : row.product_type === 'food' ? 'г' : 'мл' }
}

// Блюдо для админки.
export function dishView(row, { modifiers = [], now = new Date(), popularTwinId = null } = {}) {
  const info = row.nutritional_info && typeof row.nutritional_info === 'object' && !Array.isArray(row.nutritional_info) ? row.nutritional_info : {}
  const kbju = Object.fromEntries(KBJU.map(([k, db]) => [k, num(info[db])]))
  const ingredients = Array.isArray(row.ingredients)
    ? row.ingredients.map((s) => String(s).trim()).filter(Boolean)
    : String(row.ingredients || '').split(',').map((s) => s.trim()).filter(Boolean)
  return {
    id: row.id,
    name: row.dish_name,
    section: row.menu_section || '',
    sectionOrder: row.section_order ?? null,
    price: Number(row.cost_rub || 0),
    productType: row.product_type || 'food',
    weight: parseWeight(row),
    cookTimeMin: row.cook_time_min ?? null,
    description: row.description || '',
    ingredients,
    kbju: Object.values(kbju).some((v) => v != null) ? kbju : null,
    // Свойства напитка («Крепость», «Полнота»…) — прочие ключи nutritional_info.
    specs: Object.entries(info).filter(([k, v]) => !NOT_SPECS.has(k) && v != null && v !== '').map(([key, value]) => ({ key, value: String(value) })),
    // Вино: аромат, сорт винограда, год производства — свои поля в форме.
    aroma: info[AROMA_KEY] != null ? String(info[AROMA_KEY]) : '',
    grape: info[GRAPE_KEY] != null ? String(info[GRAPE_KEY]) : '',
    vintage: num(info[VINTAGE_KEY]),
    tags: Array.isArray(row.tags) ? row.tags : [],
    imageUrl: row.image_url || '',
    thumbUrl: row.image_url_thumbnail || '',
    hidden: !!row.is_hidden,
    available: row.is_available !== false,
    stopped: !!row.stop_until && new Date(row.stop_until) > now,
    courseRole: row.course_role || null,
    mealTimes: row.meal_times || [],
    place: { sectionId: row.section_id || null, subsectionId: row.subsection_id || null, subSubsectionId: row.sub_subsection_id || null },
    modifiers,
    popularTwinId,
  }
}

const text = (v, max) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

function url(v, what) {
  const s = text(v, 2000)
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) throw bad(`${what}: нужна ссылка, начинающаяся с https://`)
  return s
}

// Форма блюда → поля строки menu_items (без раздела и места у официанта —
// их проверяет menuService по данным ресторана).
export function dishFields(b) {
  const name = text(b.name, 200)
  if (!name) throw bad('Укажите название блюда')
  if (!PRODUCT_TYPES.includes(b.productType)) throw bad('Укажите тип: еда, напиток или алкоголь')
  const price = num(b.price)
  if (price == null || price < 0 || price > 10_000_000) throw bad('Укажите цену')

  const wv = num(b.weight?.value)
  const unit = WEIGHT_UNITS.includes(b.weight?.unit) ? b.weight.unit : b.productType === 'food' ? 'г' : 'мл'
  if (wv != null && (wv <= 0 || wv > 100_000)) throw bad('Вес или объём — положительное число')

  const cook = num(b.cookTimeMin)
  if (cook != null && (!Number.isInteger(cook) || cook < 0 || cook > 600)) throw bad('Время приготовления — целое число минут')

  const info = {}
  for (const [k, db] of KBJU) {
    const v = num(b.kbju?.[k])
    if (v == null) continue
    if (v < 0 || v > 100_000) throw bad('КБЖУ — неотрицательные числа')
    info[db] = v
  }
  for (const s of Array.isArray(b.specs) ? b.specs : []) {
    const key = text(s?.key, 60)
    const value = text(s?.value, 200)
    if (!key || !value || NOT_SPECS.has(key)) continue
    info[key] = /^\d+([.,]\d+)?$/.test(value) ? Number(value.replace(',', '.')) : value
  }

  const aroma = text(b.aroma, 1000)
  const grape = text(b.grape, 200)
  const vintage = num(b.vintage)
  if (vintage != null && (!Number.isInteger(vintage) || vintage < 1800 || vintage > new Date().getFullYear() + 1)) throw bad('Год производства — четыре цифры, например 2021')
  if (aroma) info[AROMA_KEY] = aroma
  if (grape) info[GRAPE_KEY] = grape
  if (vintage != null) info[VINTAGE_KEY] = vintage

  const ingredients = (Array.isArray(b.ingredients) ? b.ingredients : String(b.ingredients || '').split(','))
    .map((s) => text(s, 200)).filter(Boolean)
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : []).map((t) => text(t, 40)?.toLowerCase()).filter(Boolean))]
  const role = b.courseRole || null
  if (role && !COURSE_ROLES.includes(role)) throw bad('Неизвестная роль блюда')
  const meals = (Array.isArray(b.mealTimes) ? b.mealTimes : []).filter((m) => MEAL_TIMES.includes(m))

  return {
    dish_name: name,
    product_type: b.productType,
    cost_rub: Math.round(price * 100) / 100,
    specific_details: wv != null ? { weight_value: wv, weight_unit: unit } : null,
    weight_g: wv != null ? `/ ${wv} ${unit}.` : null,
    cook_time_min: cook,
    description: text(b.description, 2000),
    ingredients: ingredients.length ? ingredients : null,
    nutritional_info: Object.keys(info).length ? info : null,
    tags,
    image_url: url(b.imageUrl, 'Фото'),
    image_url_thumbnail: url(b.thumbUrl, 'Миниатюра'),
    is_hidden: !!b.hidden,
    is_available: b.available !== false,
    course_role: role,
    meal_times: meals.length ? [...new Set(meals)] : null,
  }
}

// Поля, общие у блюда и его копии в «Популярном»: копия — то же блюдо,
// только стоит ещё и в витринном разделе.
export const SHARED_FIELDS = [
  'dish_name', 'product_type', 'cost_rub', 'specific_details', 'weight_g', 'cook_time_min', 'description',
  'ingredients', 'nutritional_info', 'tags', 'image_url', 'image_url_thumbnail', 'is_available', 'course_role', 'meal_times',
]
export const sharedOf = (fields) => Object.fromEntries(SHARED_FIELDS.filter((k) => k in fields).map((k) => [k, fields[k]]))

// Пара «блюдо ↔ его копия в Популярном»: одно название, одна строка
// в «Популярном» и ровно одна — вне его. Одинаковые названия в разных
// обычных разделах (детская порция) копиями не считаются.
export function popularTwins(rows) {
  const byName = new Map()
  for (const r of rows) {
    const k = norm(r.dish_name)
    if (!byName.has(k)) byName.set(k, [])
    byName.get(k).push(r)
  }
  const twin = new Map()
  for (const list of byName.values()) {
    const pop = list.filter((r) => isPopular(r.menu_section))
    const own = list.filter((r) => !isPopular(r.menu_section))
    if (pop.length === 1 && own.length === 1) {
      twin.set(pop[0].id, own[0].id)
      twin.set(own[0].id, pop[0].id)
    }
  }
  return twin
}

// Разделы гостевого меню по порядку: название, порядок, сколько блюд, сколько
// скрыто от гостя, где они у официанта (чаще всего встречающееся место).
export function sectionsOf(rows) {
  const m = new Map()
  for (const r of rows) {
    const name = r.menu_section || 'Без раздела'
    const s = m.get(name) || { name, order: r.section_order ?? 9999, dishes: 0, hidden: 0, places: new Map() }
    s.order = Math.min(s.order, r.section_order ?? 9999)
    s.dishes++
    if (r.is_hidden) s.hidden++
    const key = [r.section_id, r.subsection_id, r.sub_subsection_id].join('|')
    s.places.set(key, (s.places.get(key) || 0) + 1)
    m.set(name, s)
  }
  return [...m.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ru'))
    .map(({ places, ...s }) => {
      const [key] = [...places.entries()].sort((a, b) => b[1] - a[1])[0]
      const [sectionId, subsectionId, subSubsectionId] = key.split('|').map((x) => x || null)
      return { ...s, place: { sectionId, subsectionId, subSubsectionId } }
    })
}

// Новый порядок разделов → { раздел: section_order }. Номера 1, 2, 3… по
// списку; разделы, которых нет в списке, — после, в прежнем порядке.
export function orderNumbers(order, sections) {
  const names = [...new Set((order || []).map((s) => String(s)))]
  const rest = sections.map((s) => s.name).filter((n) => !names.includes(n))
  return new Map([...names, ...rest].map((n, i) => [n, i + 1]))
}

// Картинка из браузера (data:URL или base64) → байты. Принимаем только
// WebP, JPEG и PNG (проверяем по первым байтам, а не по подписи) и не
// больше 700 КБ — браузер присылает уже уменьшенную.
export const MAX_IMAGE_BYTES = 700 * 1024
const IMAGE_KINDS = [
  { type: 'image/webp', ext: 'webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', test: (b) => b.toString('hex', 0, 8) === '89504e470d0a1a0a' },
]

export function decodeImage(data, what = 'Фото') {
  const raw = String(data || '').replace(/^data:[^,]*,/, '')
  if (!raw) throw bad(`${what}: файл пустой`)
  const buf = Buffer.from(raw, 'base64')
  if (buf.length > MAX_IMAGE_BYTES) throw bad(`${what} слишком большое — уменьшите его`)
  const kind = IMAGE_KINDS.find((k) => buf.length > 12 && k.test(buf))
  if (!kind) throw bad(`${what}: нужен файл JPG, PNG или WebP`)
  return { buf, type: kind.type, ext: kind.ext }
}
