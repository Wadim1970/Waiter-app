// node --test api/_lib/trainerFactsCore.test.js — факты тренажёра: проверка
// значений, факты из меню, синхронизация, готовность, подсказки аллергенов.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateFact, deriveMenuFacts, planSync, menuHash, readiness, allergenHints, batchCandidates,
  parseAiDrafts, ALLERGEN_CODES, FACT_TYPES, BATCH_FACT_TYPES, AI_FACT_TYPES,
} from './trainerFactsCore.js'

const dish = (extra = {}) => ({
  id: 'd1', dish_name: 'Цезарь с курицей', menu_section: 'Салаты', product_type: 'food',
  weight_g: '/ 320 г.', cook_time_min: 12, description: 'Салат с курицей и пармезаном',
  ingredients: ['Курица', 'Пармезан', 'Романо', 'Сухарики'], ...extra,
})

test('14 аллергенов ЕС, у каждого есть подсказки', () => {
  assert.equal(ALLERGEN_CODES.length, 14)
})

test('масса: единицы и границы', () => {
  assert.deepEqual(validateFact('weight', { value: '320', unit: 'г' }), { ok: true, value: { value: 320, unit: 'г' } })
  assert.equal(validateFact('weight', { value: 0, unit: 'г' }).ok, false)
  assert.equal(validateFact('weight', { value: 300, unit: 'фунт' }).ok, false)
  assert.equal(validateFact('weight', { value: 20000, unit: 'г' }).ok, false)
})

test('аллергены: пустой список — осознанное «аллергенов нет»; чужой код и «не применимо» нельзя', () => {
  assert.deepEqual(validateFact('allergens', { codes: [] }), { ok: true, value: { codes: [] } })
  assert.deepEqual(validateFact('allergens', { codes: ['nuts', 'gluten', 'nuts'] }).value, { codes: ['gluten', 'nuts'] })
  assert.equal(validateFact('allergens', { codes: ['pollen'] }).ok, false)
  assert.equal(validateFact('allergens', { na: true }).ok, false)
  assert.equal(validateFact('allergens', {}).ok, false)
})

test('«не применимо» — только где разрешено', () => {
  assert.deepEqual(validateFact('doneness_recommended', { na: true }), { ok: true, value: { na: true } })
  assert.equal(validateFact('weight', { na: true }).ok, false)
  assert.equal(validateFact('sauce', { na: true }).ok, false)
  assert.deepEqual(validateFact('sauce', { none: true }).value, { none: true })
  assert.equal(validateFact('sauce', { text: '  ' }).ok, false)
})

test('прожарка, гипоаллергенные ответы, винная пара', () => {
  assert.equal(validateFact('doneness_recommended', { value: 'medium_rare' }).ok, true)
  assert.equal(validateFact('doneness_recommended', { value: 'raw' }).ok, false)
  assert.equal(validateFact('gluten_free_possible', { value: 'maybe' }).ok, false)
  assert.deepEqual(validateFact('dairy_free_possible', { value: 'partial', note: ' без сливок ' }).value, { value: 'partial', note: 'без сливок' })
  assert.equal(validateFact('wine_pairing', { item_ids: ['x'] }).ok, false)
  assert.equal(validateFact('wine_pairing', { item_ids: ['11111111-1111-1111-1111-111111111111'] }).ok, true)
  assert.equal(validateFact('nope', {}).ok, false)
  assert.equal(validateFact('weight', 'abc').ok, false)
})

test('состав: дубли убираются, пустой нельзя, отметка «ключевой» сохраняется', () => {
  const r = validateFact('ingredients', { items: [{ name: 'Курица', is_key: true }, { name: ' курица ' }, 'Пармезан'] })
  assert.deepEqual(r.value.items, [{ name: 'Курица', is_key: true }, { name: 'Пармезан', is_key: false }])
  assert.equal(validateFact('ingredients', { items: [] }).ok, false)
})

test('факты из меню: масса, время, состав, описание, замены', () => {
  const f = deriveMenuFacts(dish(), [{ name: 'Прожарка', options: [{ name: 'Medium' }, { name: 'Well done' }] }])
  assert.deepEqual(f.weight, { value: 320, unit: 'г' })
  assert.deepEqual(f.cooking_time_min, { minutes: 12 })
  assert.equal(f.ingredients.items.length, 4)
  assert.equal(f.ingredients.items.every((i) => i.is_key === false), true)
  assert.equal(f.guest_description.text, 'Салат с курицей и пармезаном')
  assert.deepEqual(f.modifications.items, ['Прожарка: Medium', 'Прожарка: Well done'])
  assert.deepEqual(deriveMenuFacts({ id: 'x', dish_name: 'Пусто' }), {})
})

test('синхронизация: новое блюдо → черновики, повтор ничего не меняет', () => {
  const first = planSync(dish(), [], {})
  assert.deepEqual(first.inserts.map((i) => i.fact_type).sort(), ['cooking_time_min', 'guest_description', 'ingredients', 'weight'])
  assert.equal(first.inserts.every((i) => i.source === 'menu' && i.source_hash), true)
  const existing = Object.fromEntries(first.inserts.map((i, n) => [i.fact_type, { id: `f${n}`, status: 'confirmed', source: 'menu', ...i }]))
  const again = planSync(dish(), [], existing)
  assert.deepEqual(again, { inserts: [], updates: [] })
})

test('меню изменилось: подтверждённый факт → draft с пометкой', () => {
  const base = planSync(dish(), [], {}).inserts
  const existing = Object.fromEntries(base.map((i, n) => [i.fact_type, { id: `f${n}`, status: 'confirmed', source: 'manual', confirmed_by: 'Шеф', ...i }]))
  const plan = planSync(dish({ weight_g: '/ 350 г.' }), [], existing)
  assert.equal(plan.updates.length, 1)
  const [up] = plan.updates
  assert.equal(up.fact_type, 'weight')
  assert.equal(up.fields.status, 'draft')
  assert.equal(up.fields.confirmed_by, null)
  assert.equal(up.fields.review_note, 'menu_changed')
  assert.equal(up.action, 'menu_changed')
})

test('меню изменилось: нетронутый черновик из меню просто обновляется', () => {
  const base = planSync(dish(), [], {}).inserts
  const existing = Object.fromEntries(base.map((i, n) => [i.fact_type, { id: `f${n}`, status: 'draft', ...i }]))
  const [up] = planSync(dish({ cook_time_min: 20 }), [], existing).updates
  assert.equal(up.action, 'menu_refresh')
  assert.deepEqual(up.fields.value, { minutes: 20 })
  assert.equal(up.fields.review_note, null)
})

test('отметка «ключевой» не считается изменением меню; новое название ингредиента — считается', () => {
  const a = deriveMenuFacts(dish()).ingredients
  const marked = { items: a.items.map((i, n) => ({ ...i, is_key: n === 0 })) }
  assert.equal(menuHash('ingredients', a), menuHash('ingredients', marked))
  const b = deriveMenuFacts(dish({ ingredients: ['Курица', 'Пармезан'] })).ingredients
  assert.notEqual(menuHash('ingredients', a), menuHash('ingredients', b))
})

test('готовность: еда — уровни 1–3, ключевой ингредиент обязателен', () => {
  const ok = (type, value = {}) => ({ type, status: 'confirmed', value })
  const facts = { ingredients: ok('ingredients', { items: [{ name: 'Курица', is_key: false }] }) }
  let r = readiness(dish(), facts)
  assert.deepEqual(r[1], { ready: true, missing: [] })
  assert.deepEqual(r[2], { ready: false, missing: ['key_ingredients'] })
  assert.deepEqual(r[3].missing, ['weight', 'allergens', 'sauce'])
  facts.ingredients.value.items[0].is_key = true
  Object.assign(facts, { weight: ok('weight'), allergens: ok('allergens'), sauce: ok('sauce') })
  r = readiness(dish(), facts)
  assert.equal(r[2].ready, true)
  assert.equal(r[3].ready, true)
  // draft не считается
  facts.allergens.status = 'draft'
  assert.deepEqual(readiness(dish(), facts)[3], { ready: false, missing: ['allergens'] })
})

test('готовность: напиток — состав не учим, нужна только масса', () => {
  const r = readiness(dish({ product_type: 'alcohol' }), { weight: { status: 'confirmed' } })
  assert.deepEqual(r[2], { ready: null, missing: [] })
  assert.deepEqual(r[3], { ready: true, missing: [] })
})

test('подсказки аллергенов по составу (черновик)', () => {
  const h = allergenHints(['Фокачча', 'Бурратой', 'Песто из кедровых орехов', 'Креветки'], 'Фокачча из дровяной печи')
  assert.ok(h.gluten && h.milk && h.nuts && h.crustaceans)
  assert.equal(h.fish, undefined)
  assert.deepEqual(allergenHints(['Огурцы', 'Редис']), {})
})

test('пакетное подтверждение: аллергены — никогда, замеченные меню-изменения — пропускаем', () => {
  assert.equal(BATCH_FACT_TYPES.includes('allergens'), false)
  assert.equal(BATCH_FACT_TYPES.includes('may_contain'), false)
  assert.equal(BATCH_FACT_TYPES.includes('ingredients'), false)
  const facts = [
    { fact_type: 'weight', status: 'draft', value: { value: 1, unit: 'г' } },
    { fact_type: 'weight', status: 'draft', value: { value: 2, unit: 'г' }, review_note: 'menu_changed' },
    { fact_type: 'weight', status: 'confirmed', value: { value: 3, unit: 'г' } },
    { fact_type: 'sauce', status: 'draft', value: { none: true } },
  ]
  assert.equal(batchCandidates('weight', facts).length, 1)
  assert.deepEqual(batchCandidates('allergens', [{ fact_type: 'allergens', status: 'draft', value: { codes: [] } }]), [])
})

test('ИИ не предлагает аллергены и состав', () => {
  assert.equal(AI_FACT_TYPES.includes('allergens'), false)
  assert.equal(AI_FACT_TYPES.includes('ingredients'), false)
  assert.equal(AI_FACT_TYPES.includes('weight'), false)
  for (const t of AI_FACT_TYPES) assert.ok(FACT_TYPES[t])
})

test('разбор ответа ИИ: валидное берём, мусор и запрещённое отбрасываем', () => {
  const raw = '```json\n' + JSON.stringify({
    sauce: 'Цезарь', doneness_recommended: 'medium', flavor_profile: '', guest_description: 'Хрустящий салат',
    gluten_free_possible: { value: 'no', note: 'сухарики' }, dairy_free_possible: { value: 'perhaps' },
    allergens: { codes: [] }, weight: { value: 5, unit: 'г' },
  }) + '\n```'
  const d = parseAiDrafts(raw)
  assert.deepEqual(d.sauce, { text: 'Цезарь' })
  assert.deepEqual(d.doneness_recommended, { value: 'medium' })
  assert.deepEqual(d.guest_description, { text: 'Хрустящий салат' })
  assert.deepEqual(d.gluten_free_possible, { value: 'no', note: 'сухарики' })
  assert.equal('flavor_profile' in d, false)
  assert.equal('dairy_free_possible' in d, false)
  assert.equal('allergens' in d, false)
  assert.equal('weight' in d, false)
  assert.equal(parseAiDrafts('не json'), null)
  assert.equal(parseAiDrafts('[1,2]'), null)
})
