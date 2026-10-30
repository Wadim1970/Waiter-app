// node --test api/_lib/suggestCore.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { menuForPrompt, buildSuggestMessages, buildRecommendMessages, parsePicks, parseRecommendText, composePitch, templatePitch, templateSet, pickPools } from './suggestCore.js'

const item = (id, name, section, price, extra = {}) => ({ id, name, section, price, available: true, productType: 'food', description: '', dailyFlag: null, pushPriority: 0, ...extra })
const digest = [
  item('pop-borsch', 'Борщ', 'Популярное', 590),
  item('salad', 'Салат с бурратой', 'Салаты и закуски', 620, { description: 'Буррата, томаты, руккола', pushPriority: 2, pushReason: 'высокая маржа' }),
  item('borsch', 'Борщ', 'Супы', 590),
  item('steak', 'Стейк рибай', 'Горячие блюда', 2400),
  item('stop', 'Тирамису', 'Десерты', 450, { dailyFlag: 'stop' }),
  item('cake', 'Чизкейк', 'Десерты', 420, { dailyFlag: 'expiring' }),
  item('off', 'Лимонад', 'Напитки', 290, { available: false, productType: 'drink' }),
]

test('menuForPrompt: разделы, без стоп-листа/недоступного, повторы — один раз', () => {
  const m = menuForPrompt(digest)
  assert.equal(m.byNum.size, 4)
  assert.ok(!m.text.includes('Тирамису'))
  assert.ok(!m.text.includes('Лимонад'))
  assert.equal(m.text.match(/Борщ/g).length, 1)
  assert.match(m.text, /## Салаты и закуски\n2\. Салат с бурратой — 620 ₽\. Буррата, томаты, руккола \[приоритет: высокая маржа\]/)
  assert.match(m.text, /Чизкейк — 420 ₽ \[заканчивается сегодня\]/)
})

test('menuForPrompt: стабильный текст для одного меню (кэш DeepSeek)', () => {
  assert.equal(menuForPrompt(digest).text, menuForPrompt(digest).text)
})

test('buildSuggestMessages: меню в system, заказ и «уже предлагали» в user', () => {
  const menu = menuForPrompt(digest)
  const [sys, user] = buildSuggestMessages({ menu, tag: 'десерты', guest: { partySize: 2, occasion: 'свидание' }, cart: ['Стейк рибай'], offeredIds: ['cake'] })
  assert.ok(sys.content.includes(menu.text))
  assert.ok(!sys.content.includes('Стейк рибай') || sys.content.indexOf('Стейк рибай') > sys.content.indexOf('Меню ресторана'))
  assert.match(user.content, /гостей за столом: 2, повод: свидание/)
  assert.match(user.content, /Уже в заказе: Стейк рибай/)
  assert.match(user.content, /«десерты»/)
  assert.match(user.content, /Уже предлагали, не повторяй: 4/)
  // Запрет выдумывать популярность — в принципах, а не примерами с блюдами.
  assert.match(sys.content, /Говори только правду/)
  assert.ok(!/Цезар|каберне|наполеон/i.test(sys.content))
})

test('parsePicks: номер → блюдо, отбрасывает выдуманное, запрещённое и повторы', () => {
  const menu = menuForPrompt(digest)
  const raw = JSON.stringify({ suggestions: [
    { n: 99, offer: 'x', say: 'y' },
    { n: 3, offer: 'Стейк', say: 'Стейк?' },
    { n: 2, offer: 'Лёгкий салат к стейку.', say: 'К стейку — лёгкий салат с бурратой?', technique: 'taste_pairing', addon: 'null' },
    { n: 2, offer: 'повтор', say: 'повтор' },
    { n: 4, offer: 'Чизкейк', say: '  ' },
  ] })
  const out = parsePicks(raw, menu, new Set(['steak']))
  assert.deepEqual(out, [{ dishId: 'salad', pitch: 'Лёгкий салат к стейку: «К стейку — лёгкий салат с бурратой?»', technique: 'taste_pairing', addon: null }])
  assert.equal(parsePicks('не json', menu), null)
  assert.equal(parsePicks('{"suggestions":[]}', menu), null)
})

test('buildRecommendMessages: всё меню, заказ гостя', () => {
  const menu = menuForPrompt(digest)
  const [sys, user] = buildRecommendMessages({ menu, cart: ['Борщ'], guest: null })
  assert.ok(sys.content.includes(menu.text))
  assert.match(sys.content, /\{"offer":"…","say":"…"\}/)
  assert.match(user.content, /Уже в заказе: Борщ/)
})

test('шаблоны без ИИ не выдумывают популярность', () => {
  assert.ok(!/хвал|часто берут/.test(templatePitch(digest[1])))
  assert.ok(!/хвал|часто берут/.test(templateSet(pickPools(digest))))
})

test('composePitch: реплика всегда в одних «…», без «Скажи гостю:» и лишних кавычек', () => {
  assert.equal(composePitch('Предложите морс', 'Скажи гостю: «К мясу — клюквенный морс?»'), 'Предложите морс: «К мясу — клюквенный морс?»')
  assert.equal(composePitch('', 'Морс?'), '«Морс?»')
  assert.equal(composePitch('Морс', '  '), null)
})

test('parseRecommendText: offer+say, старый text, битый JSON не показываем', () => {
  assert.equal(parseRecommendText('{"offer":"К борщу — паштет","say":"Принести паштет с тостами?"}'), 'К борщу — паштет: «Принести паштет с тостами?»')
  assert.equal(parseRecommendText('{"text":"Готовый текст"}'), 'Готовый текст')
  assert.equal(parseRecommendText('{"text":"Предложи «вино»}'), null)
})

test('состав блюда — в меню целиком; «напитки» — только безалкогольные', () => {
  const menu = menuForPrompt([item('b', 'Борщ', 'Супы', 590, { description: 'Наваристый.', ingredients: ['свёкла', 'чеснок'] })])
  assert.match(menu.text, /Борщ — 590 ₽\. Наваристый\. Состав: свёкла, чеснок/)
  const [, user] = buildSuggestMessages({ menu, tag: 'напитки', cart: [] })
  assert.match(user.content, /безалкогольные напитки/)
})

test('меню для ИИ: у вина — вкус, сорт, год, аромат', async () => {
  const { drinkNotes } = await import('./drinkProfile.js')
  const { text } = menuForPrompt([{
    name: 'Белое вино Sauvignon Blanc', price: 650, section: 'Алкогольные напитки', productType: 'alcohol', available: true,
    description: 'Свежее белое вино', ingredients: ['цитрус', 'минералы'],
    drinkNotes: drinkNotes({ 'Крепость': 12.5, 'Сорт винограда': 'Sauvignon Blanc', 'Год производства': 2022, 'Аромат': 'крыжовник и лайм' }),
  }])
  assert.match(text, /Вкус: цитрус, минералы\. крепость 12\.5%; сорт винограда: Sauvignon Blanc; год производства: 2022; аромат: крыжовник и лайм/)
})
