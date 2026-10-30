// node --test api/_lib/menuService.test.js — раздел «Меню» на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { dishFields, dishView, parseWeight, sectionsOf, orderNumbers, popularTwins } from './menuCore.js'

const hall = await import('./hallService.js')
const svc = await import('./menuService.js')

const R = '11111111-1111-1111-1111-111111111111'
const FOOD = 'c0000000-0000-0000-0000-000000000001'
const SOUPS = 'c1000000-0000-0000-0000-000000000001'
const POP = 'c1000000-0000-0000-0000-000000000002'
const BORSCH = 'd0000000-0000-0000-0000-000000000001'
const BORSCH_POP = 'd0000000-0000-0000-0000-000000000002'
const STEAK = 'd0000000-0000-0000-0000-000000000003'

const row = (id, name, section, order, extra = {}) => ({
  id, restaurant_id: R, dish_name: name, menu_section: section, section_order: order, cost_rub: 500, product_type: 'food',
  is_hidden: false, is_available: true, section_id: FOOD, subsection_id: section === 'Популярное' ? POP : SOUPS, sub_subsection_id: null, ...extra,
})

beforeEach(() => {
  hall.deps.now = () => new Date('2026-10-30T12:00:00Z')
  hall.deps.db = fakeDb({
    restaurants: [{ id: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    menu_sections: [{ id: FOOD, restaurant_id: R, name: 'Еда', sort_order: 1 }],
    menu_subsections: [{ id: POP, section_id: FOOD, name: 'Популярное', sort_order: 1 }, { id: SOUPS, section_id: FOOD, name: 'Супы', sort_order: 2 }],
    menu_sub_subsections: [],
    menu_items: [
      row(BORSCH_POP, 'Борщ', 'Популярное', 1, { cost_rub: 830 }),
      row(BORSCH, 'Борщ', 'Супы', 2, { cost_rub: 830, weight_g: '/ 510 г.', nutritional_info: { calories_kcal: 756, fat_g: 52 }, ingredients: ['свекла', 'капуста'] }),
      row(STEAK, 'Стейк', 'Горячее', 3, { stop_until: '2026-10-31T00:00:00Z' }),
    ],
    modifier_groups: [{ id: 'g1', item_id: STEAK, name: 'Прожарка', type: 'single', required: true, sort_order: 0 }],
    modifiers: [{ id: 'm1', group_id: 'g1', name: 'Medium', price_delta: 0, is_available: true, sort_order: 0 }, { id: 'm2', group_id: 'g1', name: 'Well Done', price_delta: 0, is_available: true, sort_order: 1 }],
  })
})

test('вес из разных форм записи', () => {
  assert.deepEqual(parseWeight({ specific_details: { weight_value: 340, weight_unit: 'г' } }), { value: 340, unit: 'г' })
  assert.deepEqual(parseWeight({ specific_details: '500 мл', product_type: 'alcohol' }), { value: 500, unit: 'мл' })
  assert.deepEqual(parseWeight({ weight_g: '/ 510 г.' }), { value: 510, unit: 'г' })
  assert.deepEqual(parseWeight({ weight_g: '700', product_type: 'alcohol' }), { value: 700, unit: 'мл' })
  assert.equal(parseWeight({}), null)
})

test('форма блюда → поля БД; свойства напитка — в nutritional_info', () => {
  const f = dishFields({
    name: ' Пиво IPA ', productType: 'alcohol', price: '450', weight: { value: 500, unit: 'мл' },
    ingredients: 'Ячмень, Хмель', specs: [{ key: 'Крепость', value: '6,8' }, { key: 'Горечь', value: 'Высокая' }],
    tags: ['Пиво', 'пиво'], mealTimes: ['dinner', 'нет'],
  })
  assert.equal(f.dish_name, 'Пиво IPA')
  assert.equal(f.cost_rub, 450)
  assert.deepEqual(f.specific_details, { weight_value: 500, weight_unit: 'мл' })
  assert.equal(f.weight_g, '/ 500 мл.')
  assert.deepEqual(f.ingredients, ['Ячмень', 'Хмель'])
  assert.deepEqual(f.nutritional_info, { 'Крепость': 6.8, 'Горечь': 'Высокая' })
  assert.deepEqual(f.tags, ['пиво'])
  assert.deepEqual(f.meal_times, ['dinner'])
  assert.throws(() => dishFields({ name: '', productType: 'food', price: 1 }), /название/)
  assert.throws(() => dishFields({ name: 'X', productType: 'food', price: '' }), /цену/)
  assert.throws(() => dishFields({ name: 'X', productType: 'food', price: 1, imageUrl: 'ftp://x' }), /ссылка/)

  const v = dishView({ id: 1, dish_name: 'Пиво', product_type: 'alcohol', nutritional_info: f.nutritional_info, specific_details: '500 мл' })
  assert.equal(v.kbju, null)
  assert.deepEqual(v.specs, [{ key: 'Крепость', value: '6.8' }, { key: 'Горечь', value: 'Высокая' }])
})

test('разделы по порядку, копии в «Популярном», новый порядок', () => {
  const rows = hall.deps.db.tables.menu_items
  assert.deepEqual(sectionsOf(rows).map((s) => [s.name, s.order, s.dishes]), [['Популярное', 1, 1], ['Супы', 2, 1], ['Горячее', 3, 1]])
  assert.equal(popularTwins(rows).get(BORSCH), BORSCH_POP)
  assert.deepEqual([...orderNumbers(['Супы', 'Популярное'], sectionsOf(rows))], [['Супы', 1], ['Популярное', 2], ['Горячее', 3]])
})

test('меню целиком: блюда, добавки, стоп, дерево официанта', async () => {
  const m = await svc.getMenu(R)
  assert.deepEqual(m.sections.map((s) => s.name), ['Популярное', 'Супы', 'Горячее'])
  const steak = m.dishes.find((d) => d.id === STEAK)
  assert.equal(steak.stopped, true)
  assert.deepEqual(steak.modifiers[0].options.map((o) => o.name), ['Medium', 'Well Done'])
  const borsch = m.dishes.find((d) => d.id === BORSCH)
  assert.deepEqual(borsch.weight, { value: 510, unit: 'г' })
  assert.deepEqual(borsch.kbju, { kcal: 756, protein: null, fat: 52, carbs: null })
  assert.equal(borsch.popularTwinId, BORSCH_POP)
  assert.deepEqual(m.tree.map((s) => [s.name, s.children.map((c) => c.name)]), [['Еда', ['Популярное', 'Супы']]])
})

const base = { productType: 'food', price: 900, place: { sectionId: FOOD, subsectionId: SOUPS } }

test('новое блюдо в существующий раздел и в новый — с подразделом у официанта', async () => {
  const { id } = await svc.createDish(R, { ...base, name: 'Уха', section: 'Супы' })
  let rows = hall.deps.db.tables.menu_items
  assert.equal(rows.find((r) => r.id === id).section_order, 2)

  const { id: d2 } = await svc.createDish(R, {
    ...base, name: 'Тирамису', section: 'Десерты', sectionsOrder: ['Популярное', 'Десерты', 'Супы', 'Горячее'],
    place: { sectionId: FOOD, subsectionId: 'new' },
  })
  rows = hall.deps.db.tables.menu_items
  const t = rows.find((r) => r.id === d2)
  assert.equal(t.section_order, 2)
  assert.equal(rows.find((r) => r.id === BORSCH).section_order, 3)
  assert.equal(rows.find((r) => r.id === STEAK).section_order, 4)
  const sub = hall.deps.db.tables.menu_subsections.find((s) => s.name === 'Десерты')
  assert.equal(t.subsection_id, sub.id)
  await assert.rejects(() => svc.createDish(R, { ...base, name: 'X', section: 'Супы', place: { sectionId: 'чужой' } }), (e) => e.status === 400)
})

test('правка блюда меняет и его копию в «Популярном»; добавки по id', async () => {
  await svc.updateDish(R, BORSCH, { ...base, name: 'Борщ', section: 'Супы', price: 900, description: 'С салом' })
  const rows = hall.deps.db.tables.menu_items
  assert.equal(rows.find((r) => r.id === BORSCH_POP).cost_rub, 900)
  assert.equal(rows.find((r) => r.id === BORSCH_POP).description, 'С салом')
  assert.equal(rows.find((r) => r.id === BORSCH_POP).menu_section, 'Популярное')

  await svc.updateDish(R, STEAK, {
    ...base, name: 'Стейк', section: 'Горячее',
    modifiers: [{ id: 'g1', name: 'Прожарка', type: 'single', required: true, options: [{ id: 'm1', name: 'Medium' }, { name: 'Rare', priceDelta: 0 }] }, { name: 'Соус', type: 'multi', options: [{ name: 'Перечный', priceDelta: 150 }] }],
  })
  const m = await svc.getMenu(R)
  const mods = m.dishes.find((d) => d.id === STEAK).modifiers
  assert.deepEqual(mods.map((g) => [g.name, g.type, g.options.map((o) => `${o.name}:${o.priceDelta}`)]), [['Прожарка', 'single', ['Medium:0', 'Rare:0']], ['Соус', 'multi', ['Перечный:150']]])
})

test('«Показывать в Популярном»: включить и выключить', async () => {
  await svc.updateDish(R, STEAK, { ...base, name: 'Стейк', section: 'Горячее', inPopular: true })
  let pop = hall.deps.db.tables.menu_items.filter((r) => r.menu_section === 'Популярное').map((r) => r.dish_name)
  assert.deepEqual(pop.sort(), ['Борщ', 'Стейк'])
  await svc.updateDish(R, STEAK, { ...base, name: 'Стейк', section: 'Горячее', inPopular: false })
  pop = hall.deps.db.tables.menu_items.filter((r) => r.menu_section === 'Популярное').map((r) => r.dish_name)
  assert.deepEqual(pop, ['Борщ'])
})

test('разделы: переименовать (и у официанта), перенести блюда, удалить пустой', async () => {
  await svc.sectionAction(R, { op: 'rename', name: 'Супы', to: 'Первые блюда' })
  assert.equal(hall.deps.db.tables.menu_items.find((r) => r.id === BORSCH).menu_section, 'Первые блюда')
  assert.ok(hall.deps.db.tables.menu_subsections.some((s) => s.name === 'Первые блюда'))
  await assert.rejects(() => svc.sectionAction(R, { op: 'rename', name: 'Горячее', to: 'первые блюда' }), (e) => e.status === 409)

  await assert.rejects(() => svc.sectionAction(R, { op: 'delete', name: 'Первые блюда' }), (e) => e.status === 409)
  await svc.sectionAction(R, { op: 'move', name: 'Первые блюда', to: 'Горячее' })
  assert.equal(hall.deps.db.tables.menu_items.find((r) => r.id === BORSCH).menu_section, 'Горячее')
  await svc.sectionAction(R, { op: 'order', order: ['Горячее', 'Популярное'] })
  assert.equal(hall.deps.db.tables.menu_items.find((r) => r.id === BORSCH_POP).section_order, 2)
})

test('удалить блюдо; чужое — 404', async () => {
  await svc.deleteDish(R, STEAK)
  assert.equal(hall.deps.db.tables.menu_items.some((r) => r.id === STEAK), false)
  await assert.rejects(() => svc.deleteDish(R, STEAK), (e) => e.status === 404)
})

test('фото с компьютера: проверка файла, загрузка в хранилище, адреса', async () => {
  const saved = []
  hall.deps.db.storage = {
    from: (bucket) => ({
      upload: async (path, buf, opts) => { saved.push({ bucket, path, size: buf.length, type: opts.contentType }); return { error: null } },
      getPublicUrl: (path) => ({ data: { publicUrl: `https://supabase.restai.pro/storage/v1/object/public/${bucket}/${path}` } }),
    }),
  }
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]).toString('base64')
  const jpeg = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).toString('base64')}`
  const r = await svc.uploadPhoto(R, { dishId: BORSCH, photo: webp, thumb: jpeg })
  assert.match(r.imageUrl, new RegExp(`/menu-images/${R}/dishes/${BORSCH}_[0-9a-f]{8}\\.webp$`))
  assert.match(r.thumbUrl, /_thumb\.jpg$/)
  assert.deepEqual(saved.map((s) => s.type), ['image/webp', 'image/jpeg'])

  const n = await svc.uploadPhoto(R, { photo: webp })
  assert.match(n.imageUrl, /\/dishes\/new_/)
  await assert.rejects(() => svc.uploadPhoto(R, { photo: Buffer.from('<svg/>').toString('base64') }), /JPG, PNG или WebP/)
  await assert.rejects(() => svc.uploadPhoto(R, { photo: Buffer.alloc(800 * 1024, 1).toString('base64') }), /слишком большое/)
})
