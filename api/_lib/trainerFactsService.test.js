// node --test api/_lib/trainerFactsService.test.js — контент-студия на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'

const hall = await import('./hallService.js')
const svc = await import('./trainerFactsService.js')

const R = '11111111-1111-1111-1111-111111111111'
const CAESAR = 'd0000000-0000-0000-0000-000000000001'
const CAESAR_POP = 'd0000000-0000-0000-0000-000000000002'
const STEAK = 'd0000000-0000-0000-0000-000000000003'
const WINE = 'd0000000-0000-0000-0000-000000000004'

const row = (id, name, section, extra = {}) => ({
  id, restaurant_id: R, dish_name: name, menu_section: section, section_order: 1, cost_rub: 500, product_type: 'food',
  is_hidden: false, is_available: true, ingredients: [], description: '', ...extra,
})

let t
beforeEach(() => {
  hall.deps.now = () => new Date('2026-11-01T10:00:00Z')
  hall.deps.db = fakeDb({
    restaurants: [{ id: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    menu_items: [
      row(CAESAR_POP, 'Цезарь с курицей', 'Популярное', { weight_g: '/ 320 г.', ingredients: ['Курица', 'Пармезан'] }),
      row(CAESAR, 'Цезарь с курицей', 'Салаты', { weight_g: '/ 320 г.', cook_time_min: 12, description: 'Салат с курицей', ingredients: ['Курица', 'Пармезан', 'Сухарики'] }),
      row(STEAK, 'Рибай', 'Горячее', { weight_g: '/ 300 г.', ingredients: ['Говядина'] }),
      row(WINE, 'Мальбек', 'Вино', { product_type: 'alcohol', weight_g: '150 мл' }),
    ],
    modifier_groups: [{ id: 'g1', item_id: STEAK, name: 'Прожарка', sort_order: 0 }],
    modifiers: [{ id: 'm1', group_id: 'g1', name: 'Medium', is_available: true, sort_order: 0 }],
    trn_dish_facts: [],
    trn_fact_audit_log: [],
  })
  svc.aiDeps.hasKey = () => true
  svc.aiDeps.deepseekChat = async () => JSON.stringify({ sauce: 'Перечный', doneness_recommended: 'medium_rare', guest_description: 'Сочный стейк' })
  t = hall.deps.db.tables
})

const factOf = (dish, type) => t.trn_dish_facts.find((f) => f.dish_id === dish && f.fact_type === type)
const err = (p) => p.then(() => assert.fail('ожидалась ошибка'), (e) => e)

test('синхронизация: черновики из меню, копия в «Популярном» пропущена, повтор ничего не создаёт', async () => {
  const r = await svc.syncFacts(R)
  assert.equal(r.dishes, 3) // Цезарь (одна запись), Рибай, Мальбек
  assert.equal(t.trn_dish_facts.some((f) => f.dish_id === CAESAR_POP), false)
  assert.deepEqual(t.trn_dish_facts.filter((f) => f.dish_id === CAESAR).map((f) => f.fact_type).sort(), ['cooking_time_min', 'guest_description', 'ingredients', 'weight'])
  assert.equal(t.trn_dish_facts.every((f) => f.status === 'draft' && f.source === 'menu'), true)
  assert.deepEqual(factOf(STEAK, 'modifications').value, { items: ['Прожарка: Medium'] })
  const before = t.trn_dish_facts.length
  const again = await svc.syncFacts(R)
  assert.equal(again.created, 0)
  assert.equal(t.trn_dish_facts.length, before)
  assert.equal(t.trn_fact_audit_log.every((l) => l.action === 'seed'), true)
})

test('подтверждение требует имя, проверяет значение и пишет журнал', async () => {
  await svc.syncFacts(R)
  const noActor = await err(svc.saveFact(R, { dishId: CAESAR, factType: 'weight', value: { value: 320, unit: 'г' }, confirm: true }))
  assert.equal(noActor.status, 400)
  const badValue = await err(svc.saveFact(R, { dishId: CAESAR, factType: 'weight', value: { value: -5, unit: 'г' }, confirm: true, actor: 'Шеф Иван' }))
  assert.equal(badValue.status, 400)
  assert.equal(factOf(CAESAR, 'weight').status, 'draft')

  await svc.saveFact(R, { dishId: CAESAR, factType: 'weight', value: { value: 320, unit: 'г' }, confirm: true, actor: 'Шеф Иван' })
  const w = factOf(CAESAR, 'weight')
  assert.equal(w.status, 'confirmed')
  assert.equal(w.confirmed_by, 'Шеф Иван')
  assert.equal(w.source, 'menu') // значение не менялось — источник сохранён
  const log = t.trn_fact_audit_log.at(-1)
  assert.deepEqual([log.action, log.actor, log.old_status, log.new_status], ['confirm', 'Шеф Иван', 'draft', 'confirmed'])
})

test('правка подтверждённого факта без подтверждения возвращает его в draft, источник — manual', async () => {
  await svc.syncFacts(R)
  await svc.saveFact(R, { dishId: CAESAR, factType: 'weight', value: { value: 320, unit: 'г' }, confirm: true, actor: 'Шеф Иван' })
  await svc.saveFact(R, { dishId: CAESAR, factType: 'weight', value: { value: 340, unit: 'г' }, actor: 'Шеф Иван' })
  const w = factOf(CAESAR, 'weight')
  assert.deepEqual([w.status, w.source, w.confirmed_by], ['draft', 'manual', null])
})

test('аллергены: вручную, пустой список допустим, пакетно нельзя', async () => {
  await svc.saveFact(R, { dishId: CAESAR, factType: 'allergens', value: { codes: ['gluten', 'milk'] }, confirm: true, actor: 'Шеф Иван' })
  assert.deepEqual(factOf(CAESAR, 'allergens').value, { codes: ['gluten', 'milk'] })
  await svc.saveFact(R, { dishId: STEAK, factType: 'allergens', value: { codes: [] }, confirm: true, actor: 'Шеф Иван' })
  assert.equal(factOf(STEAK, 'allergens').status, 'confirmed')
  const e = await err(svc.batchConfirm(R, { section: 'Салаты', factType: 'allergens', actor: 'Шеф Иван' }))
  assert.equal(e.status, 400)
  assert.match(e.message, /по одному/)
})

test('изменение меню возвращает подтверждённый факт в draft и пишется в журнал', async () => {
  await svc.syncFacts(R)
  await svc.saveFact(R, { dishId: CAESAR, factType: 'weight', value: { value: 320, unit: 'г' }, confirm: true, actor: 'Шеф Иван' })
  assert.equal(factOf(CAESAR, 'weight').status, 'confirmed')

  hall.deps.db.tables.menu_items.find((m) => m.id === CAESAR).weight_g = '/ 350 г.'
  const r = await svc.syncFacts(R)
  assert.equal(r.returnedToDraft, 1)
  const w = factOf(CAESAR, 'weight')
  assert.deepEqual([w.status, w.review_note, w.confirmed_by], ['draft', 'menu_changed', null])
  assert.deepEqual(w.value, { value: 320, unit: 'г' }) // значение шефа не стёрто
  assert.equal(t.trn_fact_audit_log.at(-1).action, 'menu_changed')

  // повторная синхронизация — без новых сбросов
  assert.equal((await svc.syncFacts(R)).returnedToDraft, 0)
  // повторное подтверждение снимает пометку
  await svc.setFactStatus(R, { dishId: CAESAR, factType: 'weight', action: 'confirm', actor: 'Шеф Иван' })
  assert.equal(factOf(CAESAR, 'weight').review_note, null)
})

test('пакетное подтверждение: только раздел, только черновики без пометки', async () => {
  await svc.syncFacts(R)
  await svc.saveFact(R, { dishId: STEAK, factType: 'weight', value: { value: 300, unit: 'г' }, confirm: true, actor: 'Шеф Иван' })
  hall.deps.db.tables.menu_items.find((m) => m.id === STEAK).weight_g = '/ 400 г.'
  await svc.syncFacts(R) // у стейка факт снова draft с пометкой menu_changed
  const r = await svc.batchConfirm(R, { section: 'Горячее', factType: 'weight', actor: 'Шеф Иван' })
  assert.deepEqual(r, { confirmed: 0, skipped: 1 })
  const salads = await svc.batchConfirm(R, { section: 'Салаты', factType: 'weight', actor: 'Шеф Иван' })
  assert.equal(salads.confirmed, 1)
  assert.equal(factOf(CAESAR, 'weight').status, 'confirmed')
  assert.equal(factOf(STEAK, 'weight').status, 'draft')
  assert.equal(t.trn_fact_audit_log.filter((l) => l.action === 'batch_confirm').length, 1)
})

test('reject и reset', async () => {
  await svc.syncFacts(R)
  await svc.setFactStatus(R, { dishId: CAESAR, factType: 'guest_description', action: 'reject', actor: 'Шеф Иван' })
  assert.equal(factOf(CAESAR, 'guest_description').status, 'rejected')
  await svc.setFactStatus(R, { dishId: CAESAR, factType: 'guest_description', action: 'reset', actor: 'Шеф Иван' })
  assert.equal(factOf(CAESAR, 'guest_description').status, 'draft')
  const e = await err(svc.setFactStatus(R, { dishId: CAESAR, factType: 'sauce', action: 'confirm', actor: 'Шеф Иван' }))
  assert.equal(e.status, 404) // факта ещё нет
})

test('ИИ: создаёт только черновики в пустых фактах, подтверждённое и введённое шефом не трогает', async () => {
  await svc.syncFacts(R)
  await svc.saveFact(R, { dishId: STEAK, factType: 'doneness_recommended', value: { value: 'medium' }, confirm: true, actor: 'Шеф Иван' })
  const r = await svc.aiDraft(R, { dishId: STEAK, actor: 'Шеф Иван' })
  assert.deepEqual(r.created.sort(), ['guest_description', 'sauce'])
  const sauce = factOf(STEAK, 'sauce')
  assert.deepEqual([sauce.status, sauce.source, sauce.value], ['draft', 'ai', { text: 'Перечный' }])
  assert.deepEqual(factOf(STEAK, 'doneness_recommended').value, { value: 'medium' }) // не перезаписан
  assert.equal(factOf(STEAK, 'doneness_recommended').status, 'confirmed')
  assert.equal(t.trn_dish_facts.some((f) => f.source === 'ai' && f.status === 'confirmed'), false)
  // повтор: свои ИИ-черновики можно обновить, остальное — нет
  const again = await svc.aiDraft(R, { dishId: STEAK, actor: 'Шеф Иван' })
  assert.deepEqual(again.created.sort(), ['guest_description', 'sauce'])
})

test('ИИ: нет ключа — 503; два невалидных ответа подряд — 502, фактов не создано', async () => {
  svc.aiDeps.hasKey = () => false
  assert.equal((await err(svc.aiDraft(R, { dishId: STEAK, actor: 'Шеф Иван' }))).status, 503)
  svc.aiDeps.hasKey = () => true
  let calls = 0
  svc.aiDeps.deepseekChat = async () => { calls++; return 'не json' }
  assert.equal((await err(svc.aiDraft(R, { dishId: STEAK, actor: 'Шеф Иван' }))).status, 502)
  assert.equal(calls, 2)
  assert.equal(t.trn_dish_facts.length, 0)
})

test('винная пара: только алкоголь этого ресторана', async () => {
  const e = await err(svc.saveFact(R, { dishId: STEAK, factType: 'wine_pairing', value: { item_ids: [CAESAR] }, actor: 'Шеф Иван' }))
  assert.equal(e.status, 400)
  await svc.saveFact(R, { dishId: STEAK, factType: 'wine_pairing', value: { item_ids: [WINE] }, confirm: true, actor: 'Шеф Иван' })
  assert.deepEqual(factOf(STEAK, 'wine_pairing').value, { item_ids: [WINE] })
})

test('синхронизация создаёт факты вина (сорт, год); подтверждаются поштучно и сбрасываются при смене года', async () => {
  t.menu_items.find((m) => m.id === WINE).nutritional_info = { 'Сорт винограда': 'Мальбек', 'Год производства': 2020 }
  await svc.syncFacts(R)
  assert.deepEqual(factOf(WINE, 'wine_grape').value, { grapes: ['Мальбек'] })
  assert.deepEqual(factOf(WINE, 'wine_vintage').value, { year: 2020 })
  assert.equal(factOf(WINE, 'wine_vintage').status, 'draft')
  await svc.saveFact(R, { dishId: WINE, factType: 'wine_vintage', value: { year: 2020 }, confirm: true, actor: 'Сомелье' })
  assert.equal(factOf(WINE, 'wine_vintage').status, 'confirmed')
  const e = await err(svc.batchConfirm(R, { section: 'Вино', factType: 'wine_vintage', actor: 'Сомелье' }))
  assert.equal(e.status, 400) // пакетно нельзя
  t.menu_items.find((m) => m.id === WINE).nutritional_info = { 'Сорт винограда': 'Мальбек', 'Год производства': 2021 }
  await svc.syncFacts(R)
  assert.deepEqual([factOf(WINE, 'wine_vintage').status, factOf(WINE, 'wine_vintage').review_note], ['draft', 'menu_changed'])
})

test('список блюд: готовность по уровням и сводка по разделам', async () => {
  await svc.syncFacts(R)
  await svc.saveFact(R, { dishId: CAESAR, factType: 'ingredients', value: { items: [{ name: 'Курица', is_key: true }] }, confirm: true, actor: 'Шеф Иван' })
  const s = await svc.getStudio(R)
  assert.equal(s.dishes.length, 3)
  const caesar = s.dishes.find((d) => d.id === CAESAR)
  assert.equal(caesar.ready[2].ready, true)
  assert.equal(caesar.ready[3].ready, false)
  assert.deepEqual(caesar.ready[3].missing, ['weight', 'allergens', 'sauce'])
  const wine = s.dishes.find((d) => d.id === WINE)
  assert.equal(wine.ready[2].ready, null)
  const salads = s.sections.find((x) => x.name === 'Салаты')
  assert.deepEqual([salads.dishes, salads.ready[2], salads.applicable[2]], [1, 1, 1])
  assert.ok(s.meta.factTypes.find((f) => f.key === 'allergens' && !f.batch))
})

test('карточка блюда: факты, подсказки аллергенов, список алкоголя, журнал', async () => {
  await svc.syncFacts(R)
  const d = await svc.getDish(R, CAESAR)
  assert.equal(d.dish.name, 'Цезарь с курицей')
  assert.ok(d.allergenHints.milk) // пармезан
  assert.ok(d.allergenHints.gluten) // сухарики → «сухар»
  assert.deepEqual(d.alcohol, [{ id: WINE, name: 'Мальбек' }])
  assert.equal(d.facts.length, 4)
  assert.equal(d.log.length, 4)
  assert.equal((await err(svc.getDish(R, 'not-a-uuid'))).status, 400)
  assert.equal((await err(svc.getDish(R, '99999999-9999-9999-9999-999999999999'))).status, 404)
})
