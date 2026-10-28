// Сколько гостей сидит за столом СЕЙЧАС: всего за посадку минус ушедшие
// (оплатившие своё место). «Всего» (guest_count) остаётся для истории и аналитики.
export function presentGuests(total, left) {
  return Math.max(Number(total || 0) - Number(left || 0), 0)
}
