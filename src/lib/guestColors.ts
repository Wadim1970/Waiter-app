// Цвет гостя (места за столом): место N → N-й цвет. Один источник для всех экранов
// официанта (заказы, гость, описание гостя, комментарии).
export const GUEST_COLORS = ['#02a826', '#ce00b9', '#ff9500', '#003daf', '#6c03ed', '#0f929c', '#700061', '#979200']

// Цвет места по номеру (1, 2, …); для неизвестного — первый.
export function guestColor(seat: number | null | undefined): string {
  if (!seat || seat < 1) return '#6b7280'
  return GUEST_COLORS[seat - 1] ?? GUEST_COLORS[0]
}
