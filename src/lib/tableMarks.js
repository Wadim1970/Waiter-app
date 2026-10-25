// Галочки «обслуживаю этот стол» во вкладке «Все столы».
//
// marks — { [tableId]: { self, locked } }:
//   self   — официант сам поставил галочку (её он может снять);
//   locked — стол закрепил администратор (постоянно или на сегодня): снять нельзя.
// Стол попадает в «Мои столы», если стоит своя галочка ИЛИ он закреплён администратором.

// rows — строки waiter_table_assignments этого официанта: table_id, source, is_permanent, assigned_date.
export function buildMarks(rows, today) {
  const marks = {}
  for (const r of rows || []) {
    const m = (marks[r.table_id] ||= { self: false, locked: false })
    if (r.source === 'self') m.self = true
    else if (r.is_permanent || r.assigned_date === today) m.locked = true
  }
  return marks
}

export const isMine = (mark) => Boolean(mark && (mark.self || mark.locked))

// Мгновенное обновление после нажатия (до ответа сервера).
export function applyToggle(marks, tableId, selected) {
  const cur = marks[tableId] || { self: false, locked: false }
  const next = { ...cur, self: Boolean(selected) }
  const out = { ...marks }
  if (!next.self && !next.locked) delete out[tableId]
  else out[tableId] = next
  return out
}

// Ответ сервера set_my_table → состояние стола.
export function applyServerState(marks, tableId, state) {
  const next = { self: Boolean(state?.selected), locked: Boolean(state?.locked) }
  const out = { ...marks }
  if (!next.self && !next.locked) delete out[tableId]
  else out[tableId] = next
  return out
}
