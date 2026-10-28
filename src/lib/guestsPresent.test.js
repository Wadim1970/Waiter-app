// node --test src/lib/guestsPresent.test.js — гости за столом сейчас.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presentGuests } from './guestsPresent.js'

test('всего минус ушедшие', () => {
  assert.equal(presentGuests(4, 1), 3)
  assert.equal(presentGuests(2, 0), 2)
})

test('не бывает меньше нуля', () => {
  assert.equal(presentGuests(1, 3), 0)
})

test('пустые значения считаются нулём', () => {
  assert.equal(presentGuests(null, undefined), 0)
  assert.equal(presentGuests(3, null), 3)
})
