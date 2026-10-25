// Раздел «Кухня» в админке — ЧИСТАЯ логика: блюда меню одним списком,
// сроки стопа и «срочно продать», отчёт «долго готовились».

import { businessDay, businessDateOf } from './hallCore.js'

const norm = (s) => String(s || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ')

// Одно блюдо часто заведено несколькими строками меню (в «Популярном» и в
// своём разделе). Для кухни это одно блюдо: стоп и приоритет ставятся сразу
// на все его строки.
export function groupDishes(items) {
  const byKey = new Map()
  for (const it of items) {
    const key = `${norm(it.dish_name)}|${Number(it.cost_rub || 0)}`
    const g = byKey.get(key)
    if (g) {
      g.ids.push(it.id)
      if (it.menu_section && !g.sections.includes(it.menu_section)) g.sections.push(it.menu_section)
      g.rows.push(it)
    } else {
      byKey.set(key, { key, ids: [it.id], name: it.dish_name, sections: it.menu_section ? [it.menu_section] : [], rows: [it] })
    }
  }
  return [...byKey.values()]
}

const later = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b)
const active = (until, now) => !!until && (until === 'infinity' || new Date(until) > now)

// Сводка по блюду из его строк меню и костинга.
export function dishView(group, costingById, soldById, now) {
  let stopUntil = null, stopNote = null, urgentUntil = null, urgentNote = null
  let priority = 0, priorityReason = null, marginAbs = null, marginPct = null, selfCost = null
  let sold = 0, cookTime = null, hidden = true, available = false
  for (const r of group.rows) {
    if (active(r.stop_until, now)) { stopUntil = later(stopUntil, r.stop_until); stopNote = stopNote || r.stop_note || null }
    if (active(r.urgent_until, now)) { urgentUntil = later(urgentUntil, r.urgent_until); urgentNote = urgentNote || r.urgent_note || null }
    const c = costingById.get(r.id)
    if (c) {
      if ((c.push_priority || 0) > priority) { priority = c.push_priority; priorityReason = c.push_reason || null }
      if (c.margin_abs != null && marginAbs == null) { marginAbs = Number(c.margin_abs); marginPct = c.margin_pct != null ? Number(c.margin_pct) : null; selfCost = Number(c.self_cost || 0) }
    }
    sold += soldById.get(r.id) || 0
    if (r.cook_time_min != null) cookTime = r.cook_time_min
    if (!r.is_hidden) hidden = false
    if (r.is_available !== false) available = true
  }
  return {
    key: group.key,
    ids: group.ids,
    name: group.name,
    sections: group.sections,
    price: Number(group.rows[0].cost_rub || 0),
    cookTimeMin: cookTime,
    hidden,
    available,
    stopUntil: stopUntil === 'infinity' ? 'forever' : stopUntil,
    stopNote,
    urgentUntil,
    urgentNote,
    priority,
    priorityReason,
    marginAbs,
    marginPct,
    selfCost,
    sold30: sold,
  }
}

// «До конца дня» — до 06:00 следующего дня ресторана; «до отмены» — бессрочно.
export function untilFor(kind, tz, now = new Date()) {
  if (kind === 'forever') return 'infinity'
  if (kind === 'day') return businessDay(businessDateOf(now, tz), tz).to.toISOString()
  return null
}

// Отметку «готово» могли поставить сильно позже (забыли нажать) — такие
// случаи в статистику времени не берём, иначе одно забытое блюдо исказит всё.
export const MAX_SANE_MIN = 180

// Долго готовились: от «ушло на кухню» (sent_at) до «готово» (ready_at)
// против норматива блюда (cook_time_min).
export function slowReport(items, dishById, { limit = 200 } = {}) {
  const measured = []
  let noNorm = 0
  let insane = 0
  for (const it of items) {
    if (!it.sent_at || !it.ready_at) continue
    const actual = (new Date(it.ready_at) - new Date(it.sent_at)) / 60000
    if (actual < 0) continue
    if (actual > MAX_SANE_MIN) { insane++; continue }
    const dish = dishById.get(it.item_id)
    const normMin = dish?.cook_time_min
    if (normMin == null || normMin <= 0) { noNorm++; continue }
    measured.push({
      itemId: it.id,
      dish: dish?.dish_name || 'Блюдо удалено из меню',
      dishKey: norm(dish?.dish_name),
      sentAt: it.sent_at,
      readyAt: it.ready_at,
      actualMin: Math.round(actual),
      normMin,
      delayMin: Math.round(actual - normMin),
      late: actual > normMin,
      orderId: it.order_id,
      quantity: it.quantity || 1,
    })
  }

  const byDish = new Map()
  for (const m of measured) {
    const d = byDish.get(m.dishKey) || { dish: m.dish, normMin: m.normMin, count: 0, late: 0, sumActual: 0, maxActual: 0 }
    d.count++
    if (m.late) d.late++
    d.sumActual += m.actualMin
    d.maxActual = Math.max(d.maxActual, m.actualMin)
    byDish.set(m.dishKey, d)
  }
  const dishes = [...byDish.values()].map((d) => ({
    dish: d.dish, normMin: d.normMin, count: d.count, late: d.late,
    latePct: Math.round((d.late / d.count) * 100),
    avgActualMin: Math.round(d.sumActual / d.count),
    maxActualMin: d.maxActual,
  })).sort((a, b) => b.late - a.late || b.latePct - a.latePct || b.avgActualMin - a.avgActualMin)

  const late = measured.filter((m) => m.late)
  return {
    summary: {
      measured: measured.length,
      late: late.length,
      latePct: measured.length ? Math.round((late.length / measured.length) * 100) : 0,
      avgDelayMin: late.length ? Math.round(late.reduce((s, m) => s + m.delayMin, 0) / late.length) : 0,
      noNorm,
      skipped: insane,
    },
    dishes,
    lateItems: late.sort((a, b) => b.delayMin - a.delayMin).slice(0, limit),
  }
}
