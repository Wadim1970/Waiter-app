// Контент-студия тренажёра — ЧИСТАЯ логика: типы фактов, проверка значений,
// факты из меню, синхронизация с изменениями меню, готовность блюда к
// уровням, подсказки по аллергенам. Ввод/вывод — trainerFactsService.js.
//
// Принципы (ТЗ тренажёра, мастер-промт):
//  • единица обучения — факт о блюде; в тренажёр попадают только факты со
//    статусом confirmed (подтверждено шефом);
//  • факты из ИИ и из меню — всегда черновики (draft) до подтверждения;
//  • любое изменение данных блюда в меню возвращает подтверждённый факт
//    в draft;
//  • аллергены подтверждаются только поштучно (пакетно — нельзя).

import crypto from 'node:crypto'
import { norm, WEIGHT_UNITS, parseWeight } from './menuCore.js'

export const STATUSES = ['draft', 'confirmed', 'rejected']
export const SOURCES = ['menu', 'ai', 'manual']

// 14 аллергенов по регламенту ЕС 1169/2011. hints — основы русских слов
// для ЧЕРНОВОЙ подсказки по составу (шеф всё равно подтверждает сам).
export const ALLERGENS = [
  { code: 'gluten', name: 'Глютен (злаки)', hints: ['пшениц', 'мука', 'мучн', 'хлеб', 'багет', 'фокач', 'чиабатт', 'круассан', 'булк', 'тесто', 'теста', 'панировк', 'сухар', 'крутон', 'паста', 'спагетти', 'лапша', 'ржан', 'ячмен', 'овсян', 'кускус', 'булгур', 'лаваш', 'тортилья', 'пицц', 'брускет', 'пельмен', 'вареник', 'блин', 'соевый соус'] },
  { code: 'crustaceans', name: 'Ракообразные', hints: ['креветк', 'краб', 'лангуст', 'омар', 'раков', 'лангустин'] },
  { code: 'eggs', name: 'Яйца', hints: ['яйц', 'яичн', 'желток', 'майонез', 'омлет', 'меренг', 'аиоли', 'гоголь'] },
  { code: 'fish', name: 'Рыба', hints: ['рыб', 'лосос', 'семг', 'форел', 'тунец', 'треск', 'сельд', 'икра', 'икры', 'анчоус', 'дорад', 'сибас', 'судак', 'осетр', 'скумбри'] },
  { code: 'peanuts', name: 'Арахис', hints: ['арахис'] },
  { code: 'soy', name: 'Соя', hints: ['соя', 'соев', 'тофу', 'эдамаме', 'мисо'] },
  { code: 'milk', name: 'Молоко и молочные', hints: ['молок', 'сливк', 'сливочн', 'сыр', 'сметан', 'творог', 'йогурт', 'моцарелл', 'буррат', 'пармезан', 'горгонзол', 'рикотт', 'маскарпоне', 'кефир', 'мороженое', 'пломбир', 'бешамель', 'ряженк', 'сулугуни', 'фета', 'брынза'] },
  { code: 'nuts', name: 'Орехи', hints: ['орех', 'грецк', 'фундук', 'миндал', 'кешью', 'фисташк', 'пекан', 'кедров', 'макадамия', 'песто'] },
  { code: 'celery', name: 'Сельдерей', hints: ['сельдер'] },
  { code: 'mustard', name: 'Горчица', hints: ['горчиц'] },
  { code: 'sesame', name: 'Кунжут', hints: ['кунжут', 'тахини', 'сезам'] },
  { code: 'sulphites', name: 'Сульфиты', hints: ['вино', 'винн', 'изюм', 'курага', 'сухофрукт'] },
  { code: 'lupin', name: 'Люпин', hints: ['люпин'] },
  { code: 'molluscs', name: 'Моллюски', hints: ['мидии', 'мидий', 'устриц', 'кальмар', 'осьминог', 'гребешк', 'улитк', 'рапан'] },
]
export const ALLERGEN_CODES = ALLERGENS.map((a) => a.code)

export const DONENESS = ['rare', 'medium_rare', 'medium', 'medium_well', 'well_done']
export const YES_NO = ['yes', 'no', 'partial']

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const bad = (error) => ({ ok: false, error })
const good = (value) => ({ ok: true, value })
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Для каждого типа: подпись, проверка значения, может ли быть «не применимо»
// ({na:true}), может ли предложить ИИ, можно ли подтверждать пакетно,
// берётся ли из меню (menu — при его изменении факт возвращается в draft).
export const FACT_TYPES = {
  weight: {
    label: 'Масса / объём порции', na: false, ai: false, batch: true, menu: true,
    check(v) {
      const value = Number(v.value)
      if (!Number.isFinite(value) || value <= 0 || value > 10000) return bad('Укажите массу или объём больше нуля')
      const unit = WEIGHT_UNITS.includes(v.unit) ? v.unit : null
      if (!unit) return bad('Укажите единицу: ' + WEIGHT_UNITS.join(', '))
      return good({ value, unit })
    },
  },
  cooking_time_min: {
    label: 'Время приготовления, мин', na: false, ai: false, batch: true, menu: true,
    check(v) {
      const minutes = Number(v.minutes)
      if (!Number.isInteger(minutes) || minutes < 0 || minutes > 300) return bad('Время — целое число минут от 0 до 300')
      return good({ minutes })
    },
  },
  ingredients: {
    label: 'Состав (ключевые ингредиенты)', na: false, ai: false, batch: false, menu: true,
    check(v) {
      if (!Array.isArray(v.items)) return bad('Нужен список ингредиентов')
      const seen = new Set()
      const items = []
      for (const it of v.items) {
        const name = text(isObj(it) ? it.name : it, 80)
        if (!name || seen.has(norm(name))) continue
        seen.add(norm(name))
        items.push({ name, is_key: isObj(it) ? !!it.is_key : false })
      }
      if (!items.length) return bad('Добавьте хотя бы один ингредиент')
      if (items.length > 60) return bad('Не больше 60 ингредиентов')
      return good({ items })
    },
  },
  allergens: {
    label: 'Аллергены блюда', na: false, ai: false, batch: false, menu: false,
    check(v) {
      if (!Array.isArray(v.codes)) return bad('Нужен список аллергенов (может быть пустым — «аллергенов нет»)')
      const codes = [...new Set(v.codes)]
      if (codes.some((c) => !ALLERGEN_CODES.includes(c))) return bad('Неизвестный аллерген')
      return good({ codes: ALLERGEN_CODES.filter((c) => codes.includes(c)) })
    },
  },
  may_contain: {
    label: 'Может содержать следы (перекрёстный контакт)', na: true, ai: false, batch: false, menu: false,
    check(v) {
      if (!Array.isArray(v.codes)) return bad('Нужен список аллергенов')
      const codes = [...new Set(v.codes)]
      if (codes.some((c) => !ALLERGEN_CODES.includes(c))) return bad('Неизвестный аллерген')
      return good({ codes: ALLERGEN_CODES.filter((c) => codes.includes(c)) })
    },
  },
  sauce: {
    label: 'Соус', na: false, ai: true, batch: true, menu: false,
    check(v) {
      if (v.none === true) return good({ none: true })
      const t = text(v.text, 120)
      return t ? good({ text: t }) : bad('Укажите соус или отметьте «Без соуса»')
    },
  },
  doneness_recommended: {
    label: 'Рекомендуемая прожарка', na: true, ai: true, batch: true, menu: false,
    check(v) {
      return DONENESS.includes(v.value) ? good({ value: v.value }) : bad('Выберите прожарку')
    },
  },
  gluten_free_possible: {
    label: 'Можно без глютена', na: false, ai: true, batch: false, menu: false,
    check(v) {
      if (!YES_NO.includes(v.value)) return bad('Выберите: да, нет или частично')
      return good({ value: v.value, ...(text(v.note, 200) ? { note: text(v.note, 200) } : {}) })
    },
  },
  dairy_free_possible: {
    label: 'Можно без молочного', na: false, ai: true, batch: false, menu: false,
    check(v) {
      if (!YES_NO.includes(v.value)) return bad('Выберите: да, нет или частично')
      return good({ value: v.value, ...(text(v.note, 200) ? { note: text(v.note, 200) } : {}) })
    },
  },
  modifications: {
    label: 'Замены и добавки', na: true, ai: false, batch: true, menu: true,
    check(v) {
      if (!Array.isArray(v.items)) return bad('Нужен список замен')
      const items = [...new Set(v.items.map((s) => text(s, 80)).filter(Boolean))]
      if (!items.length) return bad('Список пуст — отметьте «Не применимо»')
      if (items.length > 30) return bad('Не больше 30 замен')
      return good({ items })
    },
  },
  wine_pairing: {
    label: 'Винная пара', na: true, ai: false, batch: false, menu: false,
    check(v) {
      if (!Array.isArray(v.item_ids)) return bad('Нужен список напитков')
      const ids = [...new Set(v.item_ids)]
      if (!ids.length || ids.length > 10) return bad('Выберите от 1 до 10 напитков или отметьте «Не применимо»')
      if (ids.some((id) => !UUID_RE.test(String(id)))) return bad('Неверный идентификатор напитка')
      return good({ item_ids: ids })
    },
  },
  flavor_profile: {
    label: 'Вкусовой профиль', na: true, ai: true, batch: true, menu: false,
    check(v) {
      const t = text(v.text, 300)
      return t ? good({ text: t }) : bad('Опишите вкус или отметьте «Не применимо»')
    },
  },
  guest_description: {
    label: 'Описание для гостя', na: false, ai: true, batch: true, menu: true,
    check(v) {
      const t = text(v.text, 500)
      return t ? good({ text: t }) : bad('Напишите описание')
    },
  },
}
export const FACT_TYPE_KEYS = Object.keys(FACT_TYPES)
export const AI_FACT_TYPES = FACT_TYPE_KEYS.filter((k) => FACT_TYPES[k].ai)
export const BATCH_FACT_TYPES = FACT_TYPE_KEYS.filter((k) => FACT_TYPES[k].batch)
export const MENU_FACT_TYPES = FACT_TYPE_KEYS.filter((k) => FACT_TYPES[k].menu)

// Значение факта: { ok, value } или { ok:false, error }. {na:true} —
// «не применимо» (только для типов с na).
export function validateFact(type, value) {
  const def = FACT_TYPES[type]
  if (!def) return bad('Неизвестный тип факта')
  if (!isObj(value)) return bad('Значение факта должно быть объектом')
  if (value.na === true) return def.na ? good({ na: true }) : bad('Для этого факта нельзя отметить «не применимо»')
  return def.check(value)
}

// ── Хэш и факты из меню ──────────────────────────────────────────────────

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}
export const hashOf = (v) => crypto.createHash('sha1').update(stable(v)).digest('hex').slice(0, 16)

// Значения фактов, которые уже есть в данных блюда меню (dishRow — строка
// menu_items; modifierGroups — [{name, options:[{name}]}]). Пустое/неверное
// пропускается.
export function deriveMenuFacts(dishRow, modifierGroups = []) {
  const out = {}
  const w = parseWeight(dishRow)
  if (w) {
    const r = validateFact('weight', w)
    if (r.ok) out.weight = r.value
  }
  if (dishRow.cook_time_min != null && dishRow.cook_time_min !== '') {
    const r = validateFact('cooking_time_min', { minutes: Number(dishRow.cook_time_min) })
    if (r.ok) out.cooking_time_min = r.value
  }
  const names = Array.isArray(dishRow.ingredients)
    ? dishRow.ingredients
    : String(dishRow.ingredients || '').split(',')
  {
    const r = validateFact('ingredients', { items: names.map((n) => ({ name: n, is_key: false })) })
    if (r.ok) out.ingredients = r.value
  }
  if (String(dishRow.description || '').trim()) {
    const r = validateFact('guest_description', { text: dishRow.description })
    if (r.ok) out.guest_description = r.value
  }
  const mods = []
  for (const g of modifierGroups) for (const o of g.options || []) mods.push(`${g.name}: ${o.name}`)
  if (mods.length) {
    const r = validateFact('modifications', { items: mods })
    if (r.ok) out.modifications = r.value
  }
  return out
}

// Что именно сравниваем с меню. Для состава — только названия (отметка
// «ключевой» принадлежит шефу и от меню не зависит).
export function menuBasis(type, value) {
  if (!value || value.na) return null
  if (type === 'ingredients') return value.items.map((i) => norm(i.name)).sort()
  return value
}
export const menuHash = (type, value) => (value ? hashOf(menuBasis(type, value)) : null)

// План синхронизации одного блюда с меню.
//  existing — { тип: строка dish_facts }.
//  inserts: новые черновики из меню; updates: что поменять в существующих
//  (fields — поля для UPDATE, audit — запись в журнал).
export function planSync(dishRow, modifierGroups, existing) {
  const derived = deriveMenuFacts(dishRow, modifierGroups)
  const inserts = []
  const updates = []
  for (const type of MENU_FACT_TYPES) {
    const value = derived[type] || null
    const hash = menuHash(type, value)
    const cur = existing[type]
    if (!cur) {
      if (value) inserts.push({ fact_type: type, value, source: 'menu', source_hash: hash })
      continue
    }
    if ((cur.source_hash || null) === hash) continue
    const fields = { source_hash: hash, review_note: 'menu_changed' }
    let action = 'menu_changed'
    if (cur.status === 'confirmed') {
      fields.status = 'draft'
      fields.confirmed_by = null
      fields.confirmed_at = null
    } else if (cur.source === 'menu' && value) {
      // Нетронутый шефом черновик из меню — просто обновляем значение.
      fields.value = value
      fields.review_note = null
      action = 'menu_refresh'
    }
    updates.push({ fact_type: type, id: cur.id, fields, action })
  }
  return { inserts, updates }
}

// ── Готовность блюда к уровням ───────────────────────────────────────────
// v1: наборы требований — константы (ТЗ: «все пороги — в настройках БД»;
// перенос в настройки ресторана — на этапе с trn_settings).
export const LEVEL_REQUIREMENTS = {
  food: { 1: [], 2: ['ingredients'], 3: ['weight', 'allergens', 'sauce'] },
  other: { 1: [], 2: null, 3: ['weight'] }, // напитки и алкоголь: состав не учим
}
export const LEVELS = [1, 2, 3]

export const isConfirmed = (f) => !!f && f.status === 'confirmed'

// factsByType: { тип: строка факта }. Возвращает по каждому уровню
// { ready: true|false|null, missing: [...] }; null — уровень блюда не касается.
export function readiness(dishRow, factsByType) {
  const req = LEVEL_REQUIREMENTS[dishRow.product_type === 'food' || !dishRow.product_type ? 'food' : 'other']
  const out = {}
  for (const level of LEVELS) {
    const types = req[level]
    if (types === null) { out[level] = { ready: null, missing: [] }; continue }
    const missing = types.filter((t) => !isConfirmed(factsByType[t]))
    if (level === 2 && !missing.length) {
      const items = factsByType.ingredients?.value?.items || []
      if (!items.some((i) => i.is_key)) missing.push('key_ingredients')
    }
    out[level] = { ready: missing.length === 0, missing }
  }
  return out
}

// ── Подсказка аллергенов по тексту (ЧЕРНОВИК, не вердикт) ────────────────
// Возвращает { код: [найденные слова] } по составу и описанию блюда.
export function allergenHints(ingredientNames, extraText = '') {
  const hay = [...(ingredientNames || []), extraText].map((s) => norm(s)).filter(Boolean)
  const out = {}
  for (const a of ALLERGENS) {
    const found = new Set()
    for (const stem of a.hints) {
      const s = norm(stem)
      for (const h of hay) if (h.includes(s)) found.add(stem)
    }
    if (found.size) out[a.code] = [...found]
  }
  return out
}

// ── Пакетное подтверждение ───────────────────────────────────────────────
// Берёт только черновики с значением, без пометки «меню изменилось» и
// только простых типов. Аллергены — никогда.
export function batchCandidates(type, facts) {
  if (!BATCH_FACT_TYPES.includes(type)) return []
  return facts.filter((f) => f.fact_type === type && f.status === 'draft' && !f.review_note && f.value)
}

// ── Ответ ИИ-черновика ───────────────────────────────────────────────────
// raw — строка JSON. Берём только допустимые для ИИ типы и только
// валидные значения; остальное молча отбрасываем.
export function parseAiDrafts(raw) {
  let data
  try { data = JSON.parse(String(raw ?? '').replace(/^```(?:json)?|```$/gm, '').trim()) } catch { return null }
  if (!isObj(data)) return null
  const out = {}
  for (const type of AI_FACT_TYPES) {
    if (!(type in data) || data[type] == null) continue
    let v = data[type]
    if (typeof v === 'string') {
      v = type === 'doneness_recommended' ? { value: v } : { text: v }
    }
    if (!isObj(v)) continue
    const r = validateFact(type, v)
    if (r.ok && !r.value.na) out[type] = r.value
  }
  return out
}

export function buildAiDraftMessages(view) {
  const lines = [
    `Блюдо: ${view.name}`,
    `Раздел меню: ${view.section}`,
    view.description ? `Описание в меню: ${view.description}` : '',
    view.ingredients.length ? `Состав в меню: ${view.ingredients.join(', ')}` : '',
    view.weight ? `Порция: ${view.weight.value} ${view.weight.unit}` : '',
  ].filter(Boolean)
  return [
    {
      role: 'system',
      content: 'Ты помощник шефа в ресторане. По данным блюда предложи ЧЕРНОВИК фактов для обучения официантов — шеф всё проверит. '
        + 'Не придумывай того, чего нельзя вывести из данных: если не уверен, ставь null. Аллергены не определяй. '
        + 'Ответ — только JSON с ключами: '
        + 'sauce (строка с названием соуса или null), '
        + 'doneness_recommended (rare|medium_rare|medium|medium_well|well_done — только для мяса, иначе null), '
        + 'flavor_profile (до 200 символов), '
        + 'guest_description (1–2 аппетитных предложения для гостя, только факты из данных), '
        + 'gluten_free_possible и dairy_free_possible (объекты {"value":"yes|no|partial","note":"..."} или null).',
    },
    { role: 'user', content: lines.join('\n') },
  ]
}
