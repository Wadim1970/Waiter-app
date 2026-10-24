// node --test api/_lib/qrService.test.js — QR допуска к смене на поддельной базе.
process.env.SUPABASE_URL ||= 'http://localhost'
process.env.SUPABASE_SERVICE_KEY ||= 'test'

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'

const svc = await import('./qrService.js')
const qrRoute = (await import('../admin/qr.js')).default
const imageRoute = (await import('../qr-image.js')).default

const R = 'dd89773c-0952-4fd1-9510-514094a928ee'
const OTHER = 'aabbccdd-1111-2222-3333-444455556666'
const NOW = new Date('2026-10-24T08:00:00Z')

function seed() {
  return fakeDb({
    restaurants: [
      { restaurantId: R, name: 'Сыроварня', timezone: 'Europe/Moscow', qr_reset_time: '06:00:00' },
      { restaurantId: OTHER, name: 'Гастро Паб', timezone: 'Europe/Moscow', qr_reset_time: '06:00:00' },
    ],
    restaurant_daily_tokens: [
      { restaurant_id: R, token: 'old-token-23', valid_date: '2026-10-23', created_at: '2026-10-23T03:00:00Z' },
      { restaurant_id: R, token: 'today-token-24', valid_date: '2026-10-24', created_at: '2026-10-24T03:00:00Z' },
      { restaurant_id: OTHER, token: 'other-token-24', valid_date: '2026-10-24', created_at: '2026-10-24T03:00:00Z' },
    ],
  })
}

let n = 0
beforeEach(() => {
  svc.deps.db = seed()
  svc.deps.now = () => NOW
  svc.deps.newToken = () => `new-token-${++n}`
  process.env.ADMIN_TOKEN = 'secret-admin-token'
  delete process.env.PAIRINGS_ADMIN_TOKEN
  delete process.env.QR_PUBLIC_BASE_URL
})

function fakeRes() {
  const r = { statusCode: 200, headers: {}, body: undefined }
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v }
  r.getHeader = (k) => r.headers[k.toLowerCase()]
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (o) => { r.body = o; return r }
  r.send = (b) => { r.body = b; return r }
  r.end = () => r
  return r
}
const req = (method, { query = {}, body, headers = {} } = {}) => ({ method, query, body, headers: { host: 'admin.restai.pro', 'x-forwarded-proto': 'https', ...headers } })

test('getQr: токен только за сегодня, история без токенов, чужого ресторана нет', async () => {
  const r = await svc.getQr(R, { base: 'https://admin.restai.pro' })
  assert.equal(r.restaurant.name, 'Сыроварня')
  assert.equal(r.restaurant.qrResetTime, '06:00')
  assert.equal(r.today, '2026-10-24')
  assert.equal(r.current.token, 'today-token-24')
  assert.deepEqual(r.history.map((h) => [h.date, h.active]), [['2026-10-24', true], ['2026-10-23', false]])
  assert.ok(!JSON.stringify(r.history).includes('old-token-23'), 'старые токены не отдаём')
  assert.ok(!JSON.stringify(r).includes('other-token-24'))
  assert.match(r.current.shareUrl, /^https:\/\/admin\.restai\.pro\/api\/qr-image\?r=dd89773c-0952-4fd1-9510-514094a928ee&d=2026-10-24&s=[0-9a-f]{32}$/)
})

test('getQr: токена на сегодня ещё нет — current пустой; ресторан не найден — 404', async () => {
  svc.deps.now = () => new Date('2026-10-25T08:00:00Z')
  assert.equal((await svc.getQr(R)).current, null)
  await assert.rejects(() => svc.getQr('11111111-1111-1111-1111-111111111111'), (e) => e.status === 404)
})

test('resetQr: новый токен на сегодня, прежний не принимается, другой ресторан не тронут', async () => {
  const r = await svc.resetQr(R)
  assert.equal(r.current.token, 'new-token-1')
  const rows = svc.deps.db.tables.restaurant_daily_tokens
  assert.equal(rows.filter((x) => x.restaurant_id === R && x.valid_date === '2026-10-24').length, 1)
  assert.ok(!rows.some((x) => x.token === 'today-token-24'))
  assert.ok(rows.some((x) => x.token === 'other-token-24'))
  assert.ok(rows.some((x) => x.token === 'old-token-23'), 'вчерашний токен остаётся в истории')
})

test('подпись: верная проходит, чужой ресторан/дата/мусор — нет; без ключа ссылок нет', () => {
  const s = svc.signLink(R, '2026-10-24')
  assert.ok(svc.verifyLink(R, '2026-10-24', s))
  assert.ok(!svc.verifyLink(OTHER, '2026-10-24', s))
  assert.ok(!svc.verifyLink(R, '2026-10-23', s))
  assert.ok(!svc.verifyLink(R, '2026-10-24', 'x'.repeat(32)))
  assert.ok(!svc.verifyLink(R, '2026-10-24', ''))
  delete process.env.ADMIN_TOKEN
  assert.equal(svc.signLink(R, '2026-10-24'), null)
  assert.ok(!svc.verifyLink(R, '2026-10-24', s))
})

test('qrImage: PNG за дату; нет токена на дату — 404', async () => {
  const png = await svc.qrImage(R, '2026-10-24')
  assert.equal(png.subarray(1, 4).toString(), 'PNG')
  await assert.rejects(() => svc.qrImage(R, '2026-10-20'), (e) => e.status === 404)
})

test('маршрут /api/admin/qr: учебный ресторан открыт, остальные — только с токеном', async () => {
  const open = fakeRes()
  await qrRoute(req('GET', { query: { restaurantId: R } }), open)
  assert.equal(open.statusCode, 200)
  assert.equal(open.body.current.token, 'today-token-24')
  const closed = fakeRes()
  await qrRoute(req('GET', { query: { restaurantId: OTHER } }), closed)
  assert.equal(closed.statusCode, 401)
  const wrong = fakeRes()
  await qrRoute(req('GET', { query: { restaurantId: OTHER }, headers: { 'x-admin-token': 'wrong-token-xxxxxxx' } }), wrong)
  assert.equal(wrong.statusCode, 401)
  const ok = fakeRes()
  await qrRoute(req('GET', { query: { restaurantId: OTHER }, headers: { 'x-admin-token': 'secret-admin-token' } }), ok)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.body.current.token, 'other-token-24')
  // сброс
  const reset = fakeRes()
  await qrRoute(req('POST', { body: { restaurantId: R, action: 'reset' } }), reset)
  assert.equal(reset.statusCode, 200)
  assert.equal(reset.body.current.token, 'new-token-' + n)
  const bad = fakeRes()
  await qrRoute(req('POST', { body: { restaurantId: R, action: 'drop' } }), bad)
  assert.equal(bad.statusCode, 400)
})

test('если открытых ресторанов нет (ADMIN_OPEN_RESTAURANTS пусто) — и учебный закрыт', async () => {
  process.env.ADMIN_OPEN_RESTAURANTS = ''
  try {
    const r = fakeRes()
    await qrRoute(req('GET', { query: { restaurantId: R } }), r)
    assert.equal(r.statusCode, 401)
    const ok = fakeRes()
    await qrRoute(req('GET', { query: { restaurantId: R }, headers: { 'x-admin-token': 'secret-admin-token' } }), ok)
    assert.equal(ok.statusCode, 200)
  } finally { delete process.env.ADMIN_OPEN_RESTAURANTS }
})

test('маршрут /api/qr-image: подпись, токен и открытый ресторан — да; чужая подпись и закрытый ресторан без всего — нет', async () => {
  const sig = svc.signLink(R, '2026-10-24')
  const bySig = fakeRes()
  await imageRoute(req('GET', { query: { r: OTHER, d: '2026-10-24', s: svc.signLink(OTHER, '2026-10-24') } }), bySig)
  assert.equal(bySig.statusCode, 200)
  assert.equal(bySig.headers['content-type'], 'image/png')
  assert.equal(bySig.headers['cache-control'], 'no-store')
  const openRest = fakeRes()
  await imageRoute(req('GET', { query: { r: R, d: '2026-10-24' } }), openRest)
  assert.equal(openRest.statusCode, 200)
  const byToken = fakeRes()
  await imageRoute(req('GET', { query: { r: OTHER, d: '2026-10-24' }, headers: { 'x-admin-token': 'secret-admin-token' } }), byToken)
  assert.equal(byToken.statusCode, 200)
  const none = fakeRes()
  await imageRoute(req('GET', { query: { r: OTHER, d: '2026-10-24' } }), none)
  assert.equal(none.statusCode, 401)
  const foreign = fakeRes()
  await imageRoute(req('GET', { query: { r: OTHER, d: '2026-10-24', s: sig } }), foreign)
  assert.equal(foreign.statusCode, 401)
  const bad = fakeRes()
  await imageRoute(req('GET', { query: { r: 'не-uuid' } }), bad)
  assert.equal(bad.statusCode, 400)
})
