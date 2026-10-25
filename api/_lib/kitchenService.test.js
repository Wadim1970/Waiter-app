// node --test api/_lib/kitchenService.test.js — раздел «Кухня» на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { slowReport, untilFor, MAX_SANE_MIN } from './kitchenCore.js'

const hall = await import('./hallService.js')
const svc = await import('./kitchenService.js')

const R = '11111111-1111-1111-1111-111111111111'
const OTHER = '22222222-2222-2222-2222-222222222222'
const NOW = new Date('2026-10-25T12:00:00Z') // 15:00 МСК

function seed() {
  return fakeDb({
    restaurants: [{ restaurantId: R, name: 'Сыроварня', timezone: 'Europe/Moscow' }],
    menu_items: [
      { id: 'b1', restaurant_id: R, dish_name: 'Борщ', menu_section: 'Популярное', section_order: 1, cost_rub: 830, cook_time_min: 15 },
      { id: 'b2', restaurant_id: R, dish_name: 'Борщ', menu_section: 'Супы', section_order: 2, cost_rub: 830, cook_time_min: 15 },
      { id: 's1', restaurant_id: R, dish_name: 'Стейк', menu_section: 'Горячее', section_order: 3, cost_rub: 4170, cook_time_min: 25 },
      { id: 'm1', restaurant_id: R, dish_name: 'Морс', menu_section: 'Напитки', section_order: 4, cost_rub: 490, cook_time_min: 3,
        stop_until: '2026-10-24T03:00:00Z' }, // вчерашний стоп — уже не действует
      { id: 'x1', restaurant_id: OTHER, dish_name: 'Чужое', cost_rub: 100 },
    ],
    menu_item_costing: [{ dish_id: 's1', restaurant_id: R, self_cost: 1500, margin_abs: 2670, margin_pct: 0.64, push_priority: 2, push_reason: 'маржа' }],
    order_items: [
      { id: 'i1', order_id: 'o1', item_id: 'b2', quantity: 2, sent_at: '2026-10-25T09:00:00Z', ready_at: '2026-10-25T09:25:00Z' }, // 25 мин при норме 15
      { id: 'i2', order_id: 'o1', item_id: 's1', quantity: 1, sent_at: '2026-10-25T09:00:00Z', ready_at: '2026-10-25T09:20:00Z' }, // 20 при 25
      { id: 'i3', order_id: 'o2', item_id: 'b1', quantity: 1, sent_at: '2026-10-25T10:00:00Z', ready_at: '2026-10-25T10:14:00Z' }, // 14 при 15
      { id: 'i4', order_id: 'o2', item_id: 'm1', quantity: 1, sent_at: '2026-10-25T10:00:00Z', ready_at: '2026-10-25T15:00:00Z' }, // 5 часов — забыли нажать
    ],
    orders: [{ id: 'o1', table_number: '3' }, { id: 'o2', table_number: '7' }],
  })
}

beforeEach(() => {
  hall.deps.db = seed()
  hall.deps.now = () => NOW
})

test('до конца дня — до 06:00 следующего дня ресторана; до отмены — бессрочно', () => {
  assert.equal(untilFor('day', 'Europe/Moscow', NOW), '2026-10-26T03:00:00.000Z')
  assert.equal(untilFor('day', 'Europe/Moscow', new Date('2026-10-25T22:30:00Z')), '2026-10-26T03:00:00.000Z') // 01:30 ночи — всё ещё «сегодня»
  assert.equal(untilFor('forever', 'Europe/Moscow', NOW), 'infinity')
})

test('блюда: повторы одного блюда — одним, продажи, маржа, приоритет, старый стоп не действует', async () => {
  const k = await svc.getKitchen(R)
  assert.deepEqual(k.dishes.map((d) => d.name), ['Борщ', 'Стейк', 'Морс'])
  const [borsch, steak, mors] = k.dishes
  assert.deepEqual(borsch.ids, ['b1', 'b2'])
  assert.deepEqual(borsch.sections, ['Популярное', 'Супы'])
  assert.equal(borsch.sold30, 3)
  assert.equal(steak.priority, 2)
  assert.equal(steak.marginAbs, 2670)
  assert.equal(mors.stopUntil, null)
  assert.deepEqual(k.sections, ['Популярное', 'Супы', 'Горячее', 'Напитки'])
})

test('стоп до конца дня и до отмены, снятие; срочно продать', async () => {
  await svc.kitchenAction(R, { action: 'stop', ids: ['b1', 'b2'], until: 'day', note: 'закончилась свёкла' })
  await svc.kitchenAction(R, { action: 'stop', ids: ['s1'], until: 'forever' })
  await svc.kitchenAction(R, { action: 'urgent', ids: ['m1'], note: 'последний день' })
  let k = await svc.getKitchen(R)
  assert.equal(k.dishes[0].stopUntil, '2026-10-26T03:00:00.000Z')
  assert.equal(k.dishes[0].stopNote, 'закончилась свёкла')
  assert.equal(k.dishes[1].stopUntil, 'forever')
  assert.equal(k.dishes[2].urgentUntil, '2026-10-26T03:00:00.000Z')
  await svc.kitchenAction(R, { action: 'unstop', ids: ['b1', 'b2'] })
  await svc.kitchenAction(R, { action: 'unurgent', ids: ['m1'] })
  k = await svc.getKitchen(R)
  assert.equal(k.dishes[0].stopUntil, null)
  assert.equal(k.dishes[2].urgentUntil, null)
  await assert.rejects(() => svc.kitchenAction(R, { action: 'stop', ids: ['b1'] }), (e) => e.status === 400)
})

test('приоритет: обновляет костинг или заводит строку; чужое блюдо — отказ', async () => {
  await svc.kitchenAction(R, { action: 'priority', ids: ['s1', 'm1'], priority: 3, reason: 'Сегодня привезли' })
  const c = hall.deps.db.tables.menu_item_costing
  assert.equal(c.find((x) => x.dish_id === 's1').push_priority, 3)
  const m = c.find((x) => x.dish_id === 'm1')
  assert.equal(m.push_priority, 3)
  assert.equal(m.sale_price, 490)
  await svc.kitchenAction(R, { action: 'priority', ids: ['s1'], priority: 0, reason: 'игнор' })
  assert.equal(c.find((x) => x.dish_id === 's1').push_reason, null)
  await assert.rejects(() => svc.kitchenAction(R, { action: 'priority', ids: ['x1'], priority: 1 }), (e) => e.status === 400)
  await assert.rejects(() => svc.kitchenAction(R, { action: 'priority', ids: ['s1'], priority: 7 }), (e) => e.status === 400)
})

test('долго готовились: против норматива, забытые отметки не считаются, стол', async () => {
  const r = await svc.getSlowDishes(R, '2026-10-25', '2026-10-25')
  assert.deepEqual(r.summary, { measured: 3, late: 1, latePct: 33, avgDelayMin: 10, noNorm: 0, skipped: 1 })
  assert.deepEqual(r.dishes.map((d) => [d.dish, d.count, d.late, d.avgActualMin, d.normMin]), [
    ['Борщ', 2, 1, 20, 15], ['Стейк', 1, 0, 20, 25],
  ])
  assert.deepEqual(r.lateItems.map((i) => [i.dish, i.actualMin, i.delayMin, i.tableNumber]), [['Борщ', 25, 10, '3']])
})

test('slowReport: без норматива — отдельно', () => {
  const r = slowReport([{ id: 'a', item_id: 'z', sent_at: '2026-10-25T10:00:00Z', ready_at: '2026-10-25T10:10:00Z' }], new Map([['z', { dish_name: 'Хлеб' }]]))
  assert.equal(r.summary.noNorm, 1)
  assert.equal(MAX_SANE_MIN, 180)
})
