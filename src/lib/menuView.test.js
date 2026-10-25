// node --test src/lib/menuView.test.js — копии блюд из «Популярного» в режиме «Все».
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hidePopularCopies } from './menuView.js'

const SUBS = [
  { id: 'pop', name: 'Популярное' },
  { id: 'soups', name: 'Супы' },
  { id: 'pasta', name: 'Паста' },
  { id: 'kids', name: 'Детское меню' },
]
const d = (id, name, sub) => ({ id, dish_name: name, subsection_id: sub })
const MENU = [
  d('b1', 'Борщ', 'pop'), d('b2', 'Борщ', 'soups'), d('s1', 'Лапша куриная', 'soups'),
  d('p1', 'Пепперони', 'pop'), // нет в другом подразделе — остаётся
  d('g1', 'Спагетти Болоньезе', 'pasta'), d('g2', 'Спагетти Болоньезе', 'kids'), // разные порции — оба остаются
]
const ids = (list) => list.map((x) => x.id)

test('в режиме «Все» копия из «Популярного» прячется, если блюдо есть в своём подразделе', () => {
  assert.deepEqual(ids(hidePopularCopies(MENU, SUBS, 'all')), ['b2', 's1', 'p1', 'g1', 'g2'])
})

test('блюдо только из «Популярного» остаётся', () => {
  assert.ok(ids(hidePopularCopies(MENU, SUBS, 'all')).includes('p1'))
})

test('одинаковые названия в разных обычных подразделах не трогаются (детская порция)', () => {
  const r = ids(hidePopularCopies(MENU, SUBS, 'all'))
  assert.ok(r.includes('g1') && r.includes('g2'))
})

test('на вкладке подраздела (в т. ч. «Популярное») список не меняется', () => {
  const popular = MENU.filter((x) => x.subsection_id === 'pop')
  assert.deepEqual(hidePopularCopies(popular, SUBS, 'pop'), popular)
  const soups = MENU.filter((x) => x.subsection_id === 'soups')
  assert.deepEqual(hidePopularCopies(soups, SUBS, 'soups'), soups)
})

test('нет подраздела «Популярное» или подразделы ещё не загрузились — список без изменений', () => {
  assert.deepEqual(hidePopularCopies(MENU, SUBS.filter((s) => s.id !== 'pop'), 'all'), MENU)
  assert.deepEqual(hidePopularCopies(MENU, [], 'all'), MENU)
})

test('название сравнивается без учёта регистра и пробелов', () => {
  const m = [d('x1', ' борщ ', 'pop'), d('x2', 'Борщ', 'soups')]
  assert.deepEqual(ids(hidePopularCopies(m, [{ id: 'pop', name: ' ПОПУЛЯРНОЕ ' }, { id: 'soups', name: 'Супы' }], 'all')), ['x2'])
})

test('пустой список', () => {
  assert.deepEqual(hidePopularCopies([], SUBS, 'all'), [])
})
