// node --test api/_lib/cartAdviceCore.test.js — время дня, роли блюд, совет к корзине.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roleOf, mealAt, mealsFor, mealOfCart } from './mealCore.js'
import { adviseCart, findGaps, dessertPicks, dessertDueAt } from './cartAdviceCore.js'

const MENU = [
  { id: 'steak', name: 'Стейк Рибай', section: 'Горячие блюда', price: 4170, description: 'Мраморная говядина на гриле.' },
  { id: 'kotleta', name: 'Котлета по-киевски с картофельным пюре', section: 'Горячие блюда', price: 980 },
  { id: 'pasta', name: 'Карбонара', section: 'Паста', price: 790 },
  { id: 'pepper', name: 'Соус перечный', section: 'Соусы', price: 150 },
  { id: 'caramel', name: 'Соус карамельный', section: 'Соусы', price: 90 },
  { id: 'fries', name: 'Картофель фри', section: 'Гарниры', price: 290 },
  { id: 'borsch', name: 'Борщ', section: 'Супы', price: 830 },
  { id: 'caesar', name: 'Цезарь с курицей', section: 'Салаты и закуски', price: 690 },
  { id: 'brusk', name: 'Брускетта с лососем', section: 'Салаты и закуски', price: 590 },
  { id: 'mors', name: 'Морс из клюквы', section: 'Напитки', productType: 'drink', price: 290 },
  { id: 'lemonade', name: 'Лимонад Тархун', section: 'Напитки', productType: 'drink', price: 390 },
  { id: 'capp', name: 'Капучино', section: 'Напитки', productType: 'drink', price: 260 },
  { id: 'wine', name: 'Вино красное, бокал', section: 'Вино', productType: 'alcohol', price: 650 },
  { id: 'syrniki', name: 'Сырники со сметаной', section: 'Завтраки', price: 450 },
  { id: 'omlet', name: 'Омлет с ветчиной', section: 'Завтраки', price: 420 },
  { id: 'tiramisu', name: 'Тирамису', section: 'Десерты', price: 520, description: 'Классический итальянский десерт. С маскарпоне.' },
  { id: 'medovik', name: 'Медовик', section: 'Десерты', price: 480, priority: 2 },
]
const PAIRS = [
  { dish_id: 'steak', pair_dish_id: 'pepper', lead: 'К стейку Рибай отлично подходит перечный соус', reason: 'Пряная острота раскроет вкус мраморной говядины.', source: 'ai', rank: 1 },
  { dish_id: 'steak', pair_dish_id: 'wine', lead: 'К стейку — бокал красного', reason: 'Танины красного вина и стейк — классика.', source: 'ai', rank: 2 },
]
const at = (h) => new Date(Date.UTC(2026, 9, 25, h - 3, 0)) // МСК
const advise = (cart, opts = {}) => adviseCart({ cart: cart.map((id) => ({ id, quantity: 1 })), menu: MENU, pairs: PAIRS, clockMeal: 'dinner', ...opts })

test('приём пищи по часам ресторана', () => {
  assert.deepEqual([7, 11, 12, 16, 17, 21, 22, 2].map((h) => mealAt(at(h), 'Europe/Moscow')),
    ['breakfast', 'breakfast', 'lunch', 'lunch', 'dinner', 'dinner', 'late', 'late'])
  // Алматы: +5 — 9:00 UTC это 14:00 там.
  assert.equal(mealAt(new Date('2026-10-25T09:00:00Z'), 'Asia/Almaty'), 'lunch')
})

test('корзина поправляет часы', () => {
  assert.equal(mealOfCart(['breakfast', 'hot_drink'], 'lunch'), 'breakfast')
  assert.equal(mealOfCart(['main'], 'breakfast'), 'lunch')
  assert.equal(mealOfCart(['soft'], 'breakfast'), 'breakfast')
})

test('роли и уместное время: суп — на обед, стейк — не на завтрак, ручная настройка важнее', () => {
  assert.equal(roleOf({ name: 'Солянка мясная', section: 'Популярное' }), 'soup')
  assert.deepEqual(mealsFor({ name: 'Борщ', section: 'Супы' }), ['lunch'])
  assert.ok(!mealsFor({ name: 'Стейк Рибай', section: 'Горячие блюда' }).includes('breakfast'))
  assert.equal(roleOf({ name: 'Чай чёрный', section: 'Популярное', productType: 'drink' }), 'hot_drink')
  assert.equal(roleOf({ name: 'Ромовая баба', section: 'Десерты' }), 'dessert')
  assert.deepEqual(mealsFor({ name: 'Борщ', section: 'Супы', mealTimes: ['lunch', 'dinner'] }), ['lunch', 'dinner'])
  assert.equal(roleOf({ name: 'Что-то', section: 'Хиты', role: 'sauce' }), 'sauce')
})

test('ужин: к стейку — соус из готовой пары с её фразой', () => {
  const a = advise(['steak'])
  assert.deepEqual([a.kind, a.gap, a.source, a.dish.id], ['suggest', 'sauce', 'pairing', 'pepper'])
  assert.equal(a.title, 'К стейку Рибай отлично подходит перечный соус')
})

test('ужин: соус есть — гарнир; гарнир есть — напиток; отказ от вина — морс по правилу', () => {
  assert.equal(advise(['steak', 'pepper']).dish.id, 'fries')
  const drink = advise(['steak', 'pepper', 'fries'])
  assert.deepEqual([drink.gap, drink.dish.id], ['drink', 'wine'])
  const soft = advise(['steak', 'pepper', 'fries'], { dismissed: { dishes: new Set(['wine']) } })
  assert.deepEqual([soft.gap, soft.source, soft.dish.id], ['drink', 'rule', 'mors'])
})

test('отказался от соуса — другой соус не предлагаем; сладкий соус к мясу — никогда', () => {
  const a = advise(['steak'], { dismissed: { gaps: new Set(['sauce']) } })
  assert.equal(a.gap, 'side')
  const noPairs = adviseCart({ cart: [{ id: 'steak' }], menu: MENU.filter((m) => m.id !== 'pepper'), pairs: [], clockMeal: 'dinner' })
  assert.notEqual(noPairs.dish?.id, 'caramel')
})

test('котлета с пюре — гарнир не нужен; паста — соус не нужен', () => {
  assert.notEqual(advise(['kotleta']).gap, 'side')
  assert.notEqual(advise(['pasta']).gap, 'sauce')
})

test('завтрак: к сырникам — горячий напиток, а не стейк или суп', () => {
  const a = advise(['syrniki'], { clockMeal: 'breakfast' })
  assert.deepEqual([a.meal, a.gap, a.dish.id], ['breakfast', 'drink', 'capp'])
  // Сырники в 15:00 — всё равно завтрак.
  assert.equal(advise(['omlet'], { clockMeal: 'lunch' }).dish.id, 'capp')
})

test('обед: к горячему — суп; к супу — горячее; ужином суп сами не предлагаем', () => {
  const lunch = advise(['steak', 'pepper', 'fries', 'mors'], { clockMeal: 'lunch' })
  assert.deepEqual([lunch.gap, lunch.dish.id], ['soup', 'borsch'])
  assert.equal(advise(['borsch', 'mors'], { clockMeal: 'lunch' }).gap, 'main')
  const dinner = advise(['pasta', 'mors'])
  assert.equal(dinner.gap, 'starter')
  assert.notEqual(dinner.dish.id, 'borsch')
})

test('поздний вечер: к вину — закуска, горячее не предлагаем', () => {
  const a = advise(['wine'], { clockMeal: 'late' })
  assert.equal(a.gap, 'snack')
  assert.ok(['caesar', 'brusk'].includes(a.dish.id))
})

test('стоп-лист, «не ем», уже в корзине — не предлагаем', () => {
  const menu = MENU.map((m) => (m.id === 'pepper' ? { ...m, stopped: true } : m))
  const a = adviseCart({ cart: [{ id: 'steak' }], menu, pairs: PAIRS, clockMeal: 'dinner' })
  assert.notEqual(a.dish?.id, 'pepper')
  const vegan = advise(['pasta', 'mors'], { blocked: (it) => /лосос|куриц/.test(it.name.toLowerCase()) })
  assert.ok(!['caesar', 'brusk'].includes(vegan.dish?.id))
})

test('всё есть — хвалим и спрашиваем про десерт; десерт уже взят или спрашивали — не спрашиваем', () => {
  const full = advise(['steak', 'pepper', 'fries', 'wine'], { dismissed: { gaps: new Set(['starter']) } })
  assert.equal(full.kind, 'complete')
  assert.equal(full.askDessert, true)
  assert.match(full.text, /десерт к ужину/)
  assert.equal(advise(['steak', 'pepper', 'fries', 'wine', 'tiramisu'], { dismissed: { gaps: new Set(['starter']) } }).askDessert, false)
  assert.equal(advise(['steak', 'pepper', 'fries', 'wine'], { dismissed: { gaps: new Set(['starter']) }, dessertAsked: true }).askDessert, false)
  const breakfast = advise(['syrniki', 'capp'], { clockMeal: 'breakfast' })
  assert.match(breakfast.text, /сладкое к завтраку/)
})

test('уже отправленное на кухню учитывается; без новых блюд — молчим', () => {
  const a = adviseCart({ cart: [{ id: 'fries' }], ordered: [{ id: 'steak' }, { id: 'pepper' }], menu: MENU, pairs: PAIRS, clockMeal: 'dinner' })
  assert.equal(a.gap, 'drink')
  assert.equal(adviseCart({ cart: [], ordered: [{ id: 'steak' }], menu: MENU, clockMeal: 'dinner' }).kind, 'none')
  assert.equal(advise(['mors']).kind, 'none')
})

test('десерты к напоминанию — приоритетные первыми, без повторов', () => {
  assert.deepEqual(dessertPicks(MENU, 'dinner').map((d) => d.id), ['medovik', 'tiramisu'])
  assert.equal(dessertPicks(MENU, 'dinner')[1].why, 'Классический итальянский десерт.')
})

test('когда напомнить о десерте', () => {
  const consent = '2026-10-25T17:00:00Z'
  assert.equal(dessertDueAt({ consentAt: consent }).toISOString(), '2026-10-25T17:40:00.000Z')
  assert.equal(dessertDueAt({ consentAt: consent, food: [{ readyAt: '2026-10-25T17:25:00Z' }, { readyAt: '2026-10-25T17:10:00Z' }] }).toISOString(), '2026-10-25T17:45:00.000Z')
  assert.equal(dessertDueAt({ consentAt: consent, food: [{ readyAt: '2026-10-25T17:25:00Z' }, { readyAt: null }] }).toISOString(), '2026-10-25T18:30:00.000Z')
})

test('порядок пробелов на ужине', () => {
  const lines = [{ id: 'steak', isNew: true, item: MENU[0], role: 'main' }]
  assert.deepEqual(findGaps(lines, 'dinner').map((g) => g.gap), ['sauce', 'side', 'drink', 'starter'])
  assert.deepEqual(findGaps(lines, 'breakfast').map((g) => g.gap), ['drink'])
})
