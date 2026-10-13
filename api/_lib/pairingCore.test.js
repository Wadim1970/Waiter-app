// node --test api/_lib/pairingCore.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  pairRejectReason, canBeAnchor, parseGenerated, dislikeMatcher, parsePersonal, menuFingerprint, guestTasteLine,
} from './pairingCore.js'

const item = (id, name, section, price, extra = {}) => ({ id, name, section, price, available: true, productType: 'food', description: '', ingredients: [], ...extra })
const pepperoni = item('p1', 'Пицца Пепперони', 'Пицца', 690, { ingredients: ['тесто', 'колбаски пепперони', 'моцарелла'] })
const margherita = item('p2', 'Пицца Маргарита', 'Пицца', 590)
const burrata = item('s1', 'Салат с бурратой', 'Салаты и закуски', 620, { description: 'Буррата, томаты, руккола', ingredients: ['буррата', 'томаты черри', 'руккола'] })
const steak = item('m1', 'Стейк рибай', 'Горячие блюда', 2400)
const lemonade = item('d1', 'Лимонад цитрус-мята', 'Напитки', 290, { productType: 'drink' })
const wine = item('w1', 'Бокал вина', 'Алкогольные напитки', 450, { productType: 'alcohol' })
const cheese = item('l1', 'Сыр качотта 300 г', 'Лавка', 600)
const sauce = item('c1', 'Соус песто', 'Соусы', 90)
const tiramisu = item('t1', 'Тирамису', 'Десерты', 390, { description: 'Маскарпоне, кофе, савоярди' })
const coffee = item('k1', 'Капучино', 'Напитки', 250, { productType: 'drink' })
const kidsPasta = item('k2', 'Паста детская', 'Детское меню', 350)

test('правила пары', () => {
  assert.equal(pairRejectReason(pepperoni, burrata), null)
  assert.equal(pairRejectReason(pepperoni, margherita), 'section')
  assert.equal(pairRejectReason(pepperoni, steak), 'main')
  assert.equal(pairRejectReason(pepperoni, wine), 'pair')
  assert.equal(pairRejectReason(pepperoni, cheese), 'pair')
  assert.equal(pairRejectReason(pepperoni, pepperoni), 'same')
  assert.equal(pairRejectReason(lemonade, steak), 'price')
  assert.equal(pairRejectReason(coffee, tiramisu), null, 'недорогое блюдо: пара до 500 ₽')
  assert.equal(pairRejectReason(pepperoni, sauce), null)
  assert.equal(canBeAnchor(sauce), false)
  assert.equal(canBeAnchor(cheese), false)
  assert.equal(pairRejectReason(kidsPasta, lemonade), null)
})

test('разбор ответа генерации отбрасывает мусор', () => {
  const items = [pepperoni, margherita, burrata, lemonade, steak, tiramisu]
  const content = JSON.stringify({ pairs: [
    { a: 1, p: 3, lead: 'К пицце Пепперони отлично подходит салат с бурратой', why: 'Сливочная буррата смягчит остроту' },
    { a: 1, p: 2, lead: 'x', why: 'y' },              // тот же раздел
    { a: 1, p: 4, lead: '«К пицце — лимонад»', why: 'Освежит' },
    { a: 1, p: 6, lead: 'третья пара', why: 'лишняя' }, // больше 2 на блюдо
    { a: 2, p: 99, lead: 'нет такого', why: 'нет' },
    { a: 5, p: 3, lead: 'не просили', why: 'не та пачка' },
    { a: 1, p: 3, lead: 'дубль', why: 'дубль' },
  ] })
  const out = parseGenerated(content, items, [1, 2])
  assert.deepEqual(out.map((x) => [x.anchorId, x.pairId, x.rank]), [['p1', 's1', 1], ['p1', 'd1', 2]])
  assert.equal(out[1].lead, 'К пицце — лимонад', 'кавычки по краям сняты')
  assert.deepEqual(parseGenerated('не json', items, [1]), [])
})

test('строгий фильтр «не ем»', () => {
  const nuts = dislikeMatcher('арахис, орехи')
  assert.equal(nuts(item('x', 'Салат с фундуком', 'Салаты', 400)), true)
  assert.equal(nuts(burrata), false)
  const veg = dislikeMatcher('Я вегетарианец')
  assert.equal(veg(pepperoni), true)
  assert.equal(veg(item('f', 'Тартар из лосося', 'Закуски', 700)), true)
  assert.equal(veg(burrata), false)
  assert.equal(veg(item('x', 'Салат', 'Салаты', 300, { description: 'Огурцы, помидоры, сметана' })), false, 'мидии не находятся в помидорах')
  const tomatoes = dislikeMatcher('помидоры, кинза')
  assert.equal(tomatoes(item('x', 'Салат', 'Салаты', 300, { ingredients: ['помидоры', 'огурцы'] })), true)
  assert.equal(tomatoes(lemonade), false)
  const dairy = dislikeMatcher('непереносимость лактозы')
  assert.equal(dairy(burrata), true)
  assert.equal(dairy(tiramisu), true, 'маскарпоне')
  const noAlco = dislikeMatcher('не пью алкоголь')
  assert.equal(noAlco(wine), true)
  assert.equal(dislikeMatcher('')(burrata), false)
})

test('разбор личного подбора', () => {
  const anchors = [{ n: 1, options: [{ n: 1 }, { n: 2 }] }, { n: 2, options: [{ n: 1 }, { n: 2 }] }]
  const m = parsePersonal(JSON.stringify({ picks: [{ a: 1, p: 2, why: 'Вы любите лимонады' }, { a: 2, p: 5 }, { a: 7, p: 1 }] }), anchors)
  assert.deepEqual([...m.entries()], [[1, { p: 2, why: 'Вы любите лимонады' }]])
})

test('хэш меню не зависит от порядка', () => {
  assert.equal(menuFingerprint([pepperoni, burrata]), menuFingerprint([burrata, pepperoni]))
  assert.notEqual(menuFingerprint([pepperoni]), menuFingerprint([{ ...pepperoni, price: 700 }]))
})

test('строка вкусов гостя', () => {
  assert.equal(guestTasteLine({ dislikes: 'кинза', history: { top_dishes: [{ name: 'Лимонад' }], sections: { Пицца: 3 } } }),
    'не ест: кинза; часто заказывает: Лимонад; любимые разделы: Пицца')
  assert.equal(guestTasteLine({}), '')
})
