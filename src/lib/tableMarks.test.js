// node --test src/lib/tableMarks.test.js — галочки «Мои столы».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMarks, isMine, applyToggle, applyServerState } from './tableMarks.js'

const TODAY = '2026-10-25'
const row = (table_id, source, is_permanent, assigned_date = '2026-10-01') => ({ table_id, source, is_permanent, assigned_date })

test('своя галочка — стол мой, снять можно', () => {
  const m = buildMarks([row('t1', 'self', true)], TODAY)
  assert.deepEqual(m.t1, { self: true, locked: false })
  assert.ok(isMine(m.t1))
})

test('закрепление администратора (постоянное или на сегодня) — стол мой, но снять нельзя', () => {
  const m = buildMarks([row('t2', 'admin', true), row('t3', 'admin', false, TODAY)], TODAY)
  assert.deepEqual(m.t2, { self: false, locked: true })
  assert.deepEqual(m.t3, { self: false, locked: true })
  assert.ok(isMine(m.t2) && isMine(m.t3))
})

test('закрепление администратора на другую дату не считается', () => {
  const m = buildMarks([row('t4', 'admin', false, '2026-10-20')], TODAY)
  assert.equal(isMine(m.t4), false)
})

test('и своя галочка, и закрепление администратора на одном столе', () => {
  const m = buildMarks([row('t5', 'self', true), row('t5', 'admin', true)], TODAY)
  assert.deepEqual(m.t5, { self: true, locked: true })
})

test('стола без записей в marks нет, он не мой', () => {
  assert.equal(isMine(buildMarks([], TODAY).x), false)
  assert.deepEqual(buildMarks(undefined, TODAY), {})
})

test('поставить галочку и снять: стол появляется и исчезает', () => {
  let m = applyToggle({}, 't1', true)
  assert.ok(isMine(m.t1))
  m = applyToggle(m, 't1', false)
  assert.equal('t1' in m, false)
})

test('снятие своей галочки со стола администратора: стол остаётся в «Моих»', () => {
  const start = buildMarks([row('t2', 'admin', true), row('t2', 'self', true)], TODAY)
  const m = applyToggle(start, 't2', false)
  assert.deepEqual(m.t2, { self: false, locked: true })
  assert.ok(isMine(m.t2))
})

test('applyToggle не меняет исходный объект', () => {
  const start = { t1: { self: true, locked: false } }
  applyToggle(start, 't1', false)
  assert.deepEqual(start, { t1: { self: true, locked: false } })
})

test('ответ сервера уточняет состояние стола', () => {
  let m = applyServerState({}, 't1', { selected: true, locked: false })
  assert.deepEqual(m.t1, { self: true, locked: false })
  m = applyServerState(m, 't1', { selected: false, locked: true })
  assert.deepEqual(m.t1, { self: false, locked: true })
  m = applyServerState(m, 't1', { selected: false, locked: false })
  assert.equal('t1' in m, false)
  assert.deepEqual(applyServerState({}, 't9', undefined), {})
})
