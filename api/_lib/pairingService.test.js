// node --test api/_lib/pairingService.test.js
// Сервис пар на поддельной базе в памяти и поддельной нейросети.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

process.env.SUPABASE_URL ||= 'http://localhost:54321'
process.env.SUPABASE_SERVICE_KEY ||= 'test'
const svc = await import('./pairingService.js')

// ── Поддельный supabase-js: from().select().eq().in().gt().maybeSingle()… ──
function fakeDb(tables, rpcs = {}) {
  const uid = () => crypto.randomUUID()
  function builder(name) {
    const t = (tables[name] ||= [])
    const filters = []
    let op = 'select', payload = null, onConflict = null, single = null
    const match = (r) => filters.every((f) => f(r))
    const run = () => {
      if (op === 'upsert') {
        const rows = (Array.isArray(payload) ? payload : [payload])
        const keys = (onConflict || 'id').split(',')
        const out = []
        for (const row of rows) {
          const ex = t.find((r) => keys.every((k) => r[k] === row[k] && row[k] !== undefined))
            || (name === 'menu_pairing_state' && t.find((r) => r.restaurant_id === row.restaurant_id))
            || (name === 'waiter_ai_cache' && t.find((r) => r.cache_key === row.cache_key))
          if (ex) { Object.assign(ex, row); out.push(ex) } else { const n = { id: uid(), ...row }; t.push(n); out.push(n) }
        }
        return out
      }
      if (op === 'update') { const rows = t.filter(match); rows.forEach((r) => Object.assign(r, payload)); return rows }
      if (op === 'delete') { const rows = t.filter(match); tables[name] = t.filter((r) => !match(r)); return rows }
      return t.filter(match).map((r) => ({ ...r }))
    }
    const api = {
      select() { return api }, eq(c, v) { filters.push((r) => r[c] === v); return api },
      in(c, arr) { filters.push((r) => arr.includes(r[c])); return api },
      gt(c, v) { filters.push((r) => r[c] > v); return api },
      upsert(p, o) { op = 'upsert'; payload = p; onConflict = o?.onConflict; return api },
      update(p) { op = 'update'; payload = p; return api },
      delete() { op = 'delete'; return api },
      maybeSingle() { single = 'maybe'; return api }, single() { single = 'one'; return api },
      then(res, rej) {
        try {
          const rows = run()
          const data = single ? (rows[0] || null) : rows
          return Promise.resolve({ data, error: null }).then(res, rej)
        } catch (e) { return Promise.reject(e).then(res, rej) }
      },
    }
    return api
  }
  return { from: builder, rpc: async (n, a) => ({ data: rpcs[n] ? rpcs[n](a) : null, error: null }), tables }
}

const R = '00000000-0000-0000-0000-0000000000aa'
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const mi = (n, name, section, price, extra = {}) => ({ id: id(n), restaurant_id: R, dish_name: name, menu_section: section, cost_rub: price, is_available: true, product_type: 'food', description: '', ingredients: [], ...extra })

let db, calls
beforeEach(() => {
  db = fakeDb({
    menu_items: [
      mi(1, 'Пицца Пепперони', 'Пицца', 690, { ingredients: ['пепперони', 'моцарелла'] }),
      mi(2, 'Салат с бурратой', 'Салаты', 620, { ingredients: ['буррата', 'томаты'] }),
      mi(3, 'Салат с орехами', 'Салаты', 450, { ingredients: ['грецкий орех', 'руккола'] }),
      mi(4, 'Лимонад', 'Напитки', 290, { product_type: 'drink' }),
      mi(5, 'Бокал вина', 'Вино', 450, { product_type: 'alcohol' }),
    ],
    restaurants: [{ restaurantId: R, name: 'Тест' }],
    menu_pairings: [], menu_pairing_state: [], waiter_ai_cache: [],
    guests: [{ id: 7, dislikes: 'орехи', preferences: { top_dishes: [{ name: 'Лимонад' }], sections: { Напитки: 4 } } }],
  }, { guest_id_for_device: ({ p_device_id }) => (p_device_id === 'dev-known' ? 7 : null) })
  calls = []
  svc.deps.supabase = db
  svc.deps.hasKey = () => true
  svc.deps.deepseekChat = async (messages) => {
    calls.push(messages)
    const sys = messages[0].content
    if (sys.includes('подбираешь ПАРУ')) {
      // номера: 1 Пепперони, 2 Буррата, 3 Орехи, 4 Лимонад, 5 Вино
      return JSON.stringify({ pairs: [
        { a: 1, p: 3, lead: 'К пицце — салат с орехами', why: 'Хруст и свежесть' },
        { a: 1, p: 2, lead: 'К пицце — салат с бурратой', why: 'Сливочно и свежо' },
        { a: 1, p: 5, lead: 'К пицце — вино', why: 'алкоголь отсеется' },
        { a: 2, p: 4, lead: 'К салату — лимонад', why: 'Освежит' },
      ] })
    }
    // личный подбор: выбрать единственный оставшийся вариант с личной фразой
    const anchors = JSON.parse(messages[1].content.split('\n').slice(2).join('\n'))
    return JSON.stringify({ picks: anchors.map((a) => ({ a: a.n, p: a.options.at(-1).n, why: 'Вы любите лимонады' })) })
  }
})

test('расчёт пар: правила, повтор без изменений, ручные и выключенные', async () => {
  const r1 = await svc.generateForRestaurant(R)
  assert.equal(r1.status, 'done')
  const pairs = db.tables.menu_pairings
  assert.deepEqual(pairs.map((p) => [p.dish_id, p.pair_dish_id]).sort(),
    [[id(1), id(2)], [id(1), id(3)], [id(2), id(4)]].sort(), 'вино отсеяно')

  const r2 = await svc.generateForRestaurant(R)
  assert.equal(r2.status, 'unchanged', 'меню не менялось — нейросеть не зовём')
  assert.equal(calls.length, 1)

  // Менеджер выключил пару и добавил ручную; перерасчёт их не трогает.
  const nut = pairs.find((p) => p.pair_dish_id === id(3))
  await svc.updatePair(R, nut.id, { status: 'disabled' })
  await svc.addManualPair(R, { dishId: id(1), pairDishId: id(4), lead: 'К пицце — лимонад', reason: 'Наш хит' })
  const r3 = await svc.generateForRestaurant(R, { force: true })
  assert.equal(r3.status, 'done')
  const after = db.tables.menu_pairings
  assert.equal(after.find((p) => p.pair_dish_id === id(3) && p.dish_id === id(1)).status, 'disabled')
  assert.equal(after.filter((p) => p.dish_id === id(1) && p.pair_dish_id === id(4)).length, 1)
  assert.equal(after.find((p) => p.dish_id === id(1) && p.pair_dish_id === id(4)).source, 'manual')

  await assert.rejects(() => svc.deletePair(R, nut.id), /только ручную/)
})

test('подбор под гостя: аллергия отсекается, ИИ выбирает и пишет лично', async () => {
  await svc.generateForRestaurant(R)
  await svc.addManualPair(R, { dishId: id(1), pairDishId: id(4), lead: 'К пицце — лимонад', reason: 'Наш хит' })

  assert.deepEqual(await svc.personalPairings({ restaurantId: R, deviceId: 'dev-unknown' }), { personal: false })

  const r = await svc.personalPairings({ restaurantId: R, deviceId: 'dev-known' })
  assert.equal(r.personal, true)
  assert.equal(r.source, 'llm')
  const forPizza = r.pairings[id(1)]
  assert.equal(forPizza.length, 1)
  assert.notEqual(forPizza[0].dishId, id(3), 'салат с орехами гостю нельзя')
  assert.equal(forPizza[0].personal, true)
  assert.equal(forPizza[0].why, 'Вы любите лимонады')
  const promptText = calls.at(-1).map((m) => m.content).join(' ')
  assert.ok(!promptText.includes('Салат с орехами'), 'запрещённое блюдо в ИИ даже не попадает')

  const again = await svc.personalPairings({ restaurantId: R, deviceId: 'dev-known' })
  assert.equal(again.cached, true, 'второй заход — из кэша')
})

test('без ключа нейросети расчёт не запускается', async () => {
  svc.deps.hasKey = () => false
  await assert.rejects(() => svc.generateForRestaurant(R), /DEEPSEEK/)
})
