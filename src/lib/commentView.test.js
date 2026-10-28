// node --test src/lib/commentView.test.js — какие комментарии и где показываем.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupComments, firstUnread, forSeat, authorLabel, isUnread } from './commentView.js'

const c = (id, seat, author, t, ack = null) => ({ id, seat_number: seat, author, body: id, created_at: `2026-10-30T14:${t}:00Z`, acknowledged_at: ack })

test('комментарии гостя с блюдами идут в его карточку, по времени', () => {
  const g = groupComments([c('b', 2, 'guest', '33'), c('a', 2, 'guest', '32'), c('x', 3, 'guest', '34')], { visibleSeats: [2, 3] })
  assert.deepEqual(g.bySeat.get(2).map((x) => x.id), ['a', 'b'])
  assert.deepEqual(g.bySeat.get(3).map((x) => x.id), ['x'])
  assert.equal(g.table.length, 0)
})

test('оплатившее место (гость ушёл) скрыто вместе с корзиной', () => {
  const g = groupComments([c('a', 1, 'guest', '30'), c('b', 2, 'guest', '31')], { visibleSeats: [2], paidSeats: [1] })
  assert.equal(g.total, 1)
  assert.equal(g.bySeat.has(1), false)
})

test('без места и место без блюд на экране — в общий список «к столу»', () => {
  const g = groupComments([c('old', null, 'guest', '10'), c('w', null, 'waiter', '11'), c('s4', 4, 'waiter', '12')], { visibleSeats: [2] })
  assert.deepEqual(g.table.map((x) => x.id), ['old', 'w', 's4'])
  assert.equal(g.bySeat.size, 0)
})

test('новый — только комментарий гостя без отметки «учтено»', () => {
  assert.equal(isUnread(c('a', 1, 'guest', '10')), true)
  assert.equal(isUnread(c('a', 1, 'guest', '10', '2026-10-30T14:40:00Z')), false)
  assert.equal(isUnread(c('w', 1, 'waiter', '10')), false)
  const g = groupComments([c('a', 1, 'guest', '10'), c('b', 1, 'guest', '11', 'x'), c('w', 1, 'waiter', '12')], { visibleSeats: [1] })
  assert.equal(g.unread, 1)
  assert.equal(g.total, 3)
})

test('первый непрочитанный — самый ранний', () => {
  const list = [c('late', 2, 'guest', '50'), c('early', 1, 'guest', '20'), c('done', 1, 'guest', '10', 'x')]
  assert.equal(firstUnread(list, { visibleSeats: [1, 2] }).id, 'early')
  assert.equal(firstUnread([c('done', 1, 'guest', '10', 'x')], { visibleSeats: [1] }), null)
})

test('экран одного гостя: его комментарии и сколько у остальных', () => {
  const list = [c('a', 1, 'guest', '10'), c('b', 2, 'guest', '11'), c('t', null, 'waiter', '12')]
  const r = forSeat(list, 1, { visibleSeats: [1, 2] })
  assert.deepEqual(r.mine.map((x) => x.id), ['a'])
  assert.equal(r.others, 2)
  assert.equal(r.unreadMine, 1)
})

test('подписи', () => {
  assert.equal(authorLabel(c('a', 2, 'guest', '10')), 'Гость 2')
  assert.equal(authorLabel(c('a', null, 'guest', '10')), 'Гость')
  assert.equal(authorLabel(c('a', null, 'waiter', '10')), 'Официант')
  assert.equal(authorLabel(c('a', 3, 'waiter', '10')), 'Официант · гость 3')
})

test('пустые данные', () => {
  const g = groupComments(undefined)
  assert.equal(g.total, 0)
  assert.equal(g.unread, 0)
})
