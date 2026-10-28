// Комментарии к заказу на экранах официанта: что показывать и где.
//
// comment: { id, seat_number | null, author: 'guest' | 'waiter', body, created_at, acknowledged_at | null }
//
// Правила:
//  • комментарии места, которое оплатило и ушло, не показываем (как и его корзину);
//  • комментарий места, у которого есть блюда на экране, — в карточке этого гостя;
//  • комментарий без места (ко всему столу, или старый без префикса «Место N») и
//    комментарий места, на экране которого нет, — общим списком «к столу»;
//  • «новый» — комментарий ГОСТЯ, который официант ещё не отметил «учтено»
//    (свои комментарии официанта новыми не считаются).

const byTime = (a, b) => String(a.created_at).localeCompare(String(b.created_at))

export function groupComments(comments, { visibleSeats = [], paidSeats = [] } = {}) {
  const visible = new Set(visibleSeats)
  const paid = new Set(paidSeats)
  const bySeat = new Map()
  const table = []
  for (const c of [...(comments || [])].sort(byTime)) {
    if (c.seat_number != null && paid.has(c.seat_number)) continue
    if (c.seat_number != null && visible.has(c.seat_number)) {
      if (!bySeat.has(c.seat_number)) bySeat.set(c.seat_number, [])
      bySeat.get(c.seat_number).push(c)
    } else {
      table.push(c)
    }
  }
  const shown = [...[...bySeat.values()].flat(), ...table]
  return {
    bySeat,
    table,
    total: shown.length,
    unread: shown.filter(isUnread).length,
  }
}

export const isUnread = (c) => c.author === 'guest' && !c.acknowledged_at

// Первый непрочитанный (для прокрутки к нему).
export function firstUnread(comments, opts) {
  const g = groupComments(comments, opts)
  const all = [...[...g.bySeat.values()].flat(), ...g.table].sort(byTime)
  return all.find(isUnread) ?? null
}

// Только комментарии этого места (для экрана одного гостя) и сколько всего у остальных.
export function forSeat(comments, seat, opts = {}) {
  const g = groupComments(comments, opts)
  const mine = g.bySeat.get(seat) || []
  const others = g.total - mine.length
  return { mine, others, unreadMine: mine.filter(isUnread).length }
}

// Подпись автора: «Гость 2» / «Официант» / «Официант · гость 2» / «Гость» (место неизвестно).
export function authorLabel(c) {
  if (c.author === 'waiter') return c.seat_number ? `Официант · гость ${c.seat_number}` : 'Официант'
  return c.seat_number ? `Гость ${c.seat_number}` : 'Гость'
}

// Время «14:32» в часовом поясе устройства.
export function formatCommentTime(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
