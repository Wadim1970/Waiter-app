// node --test api/_lib/demoWaiter.test.js — столы демо-официанта: свои галочки, снимаются.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeDb } from './testing/fakeDb.js'
import { ensureTableAssignments } from './demoWaiter.js'

const R = 'dd89773c-0952-4fd1-9510-514094a928ee'
const OTHER = '22222222-2222-2222-2222-222222222222'
const W = 'w-demo'
const cfg = { restaurantId: R, tableFrom: 1, tableTo: 3 }
const T = (n) => `t${n}`
const tables = [1, 2, 3, 4].map((n) => ({ id: T(n), restaurant_id: R, number: n })).concat([{ id: 'x1', restaurant_id: OTHER, number: 1 }])
const mine = (db) => db.tables.waiter_table_assignments.filter((a) => a.waiter_id === W)
const sig = (db) => mine(db).map((a) => `${a.table_id}:${a.source}`).sort()

test('первый вход — столы 1–3 отмечены как свои (снимаемые) галочки', async () => {
  const db = fakeDb({ tables, waiter_table_assignments: [] })
  const r = await ensureTableAssignments(db, cfg, W)
  assert.deepEqual(r.tables, [1, 2, 3])
  assert.deepEqual(sig(db), ['t1:self', 't2:self', 't3:self'])
})

test('прежние «админские» закрепления демо-официанта становятся его галочками', async () => {
  const db = fakeDb({ tables, waiter_table_assignments: [
    { id: 'a1', waiter_id: W, table_id: T(1), source: 'admin', is_permanent: true },
    { id: 'a2', waiter_id: W, table_id: T(2), source: 'admin', is_permanent: true },
    { id: 'a2s', waiter_id: W, table_id: T(2), source: 'self', is_permanent: true },
    { id: 'ax', waiter_id: W, table_id: 'x1', source: 'admin', is_permanent: true }, // чужой ресторан — не трогаем
  ] })
  const r = await ensureTableAssignments(db, cfg, W)
  assert.deepEqual(r.tables, [1, 2])
  assert.deepEqual(sig(db), ['t1:self', 't2:self', 'x1:admin'])
})

test('снятая галочка при следующем входе не возвращается; сняли все — отмечаем заново', async () => {
  const db = fakeDb({ tables, waiter_table_assignments: [{ id: 's3', waiter_id: W, table_id: T(3), source: 'self', is_permanent: true }] })
  assert.deepEqual((await ensureTableAssignments(db, cfg, W)).tables, [3])
  assert.deepEqual(sig(db), ['t3:self'])
  db.tables.waiter_table_assignments = []
  assert.deepEqual((await ensureTableAssignments(db, cfg, W)).tables, [1, 2, 3])
})
