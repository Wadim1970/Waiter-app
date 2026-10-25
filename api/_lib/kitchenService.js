// Раздел «Кухня» в админке — чтение и запись в БД (под service_role).
// Логика — kitchenCore.js.

import { deps, selectAll, selectIn, restaurantOf, httpError } from './hallService.js'
import { businessDay, businessDateOf } from './hallCore.js'
import { normalizePeriod } from './staffCore.js'
import { groupDishes, dishView, untilFor, slowReport } from './kitchenCore.js'

const MENU_COLS = 'id, dish_name, menu_section, section_order, cost_rub, cook_time_min, is_hidden, is_available, stop_until, stop_note, urgent_until, urgent_note'

async function menuOf(restaurantId) {
  return selectAll(() => deps.db.from('menu_items').select(MENU_COLS).eq('restaurant_id', restaurantId)
    .order('section_order', { ascending: true }).order('dish_name', { ascending: true }))
}

// Все блюда меню одним списком: стоп, «срочно», приоритет, маржа, продажи за 30 дней.
export async function getKitchen(restaurantId) {
  const restaurant = await restaurantOf(restaurantId)
  const now = deps.now()
  const items = await menuOf(restaurantId)
  const ids = items.map((i) => i.id)
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString()
  const [costing, sold] = await Promise.all([
    selectIn('menu_item_costing', 'dish_id, self_cost, margin_abs, margin_pct, push_priority, push_reason', 'dish_id', ids),
    selectIn('order_items', 'item_id, quantity', 'item_id', ids, (q) => q.gte('sent_at', since)),
  ])
  const costingById = new Map(costing.map((c) => [c.dish_id, c]))
  const soldById = new Map()
  for (const s of sold) soldById.set(s.item_id, (soldById.get(s.item_id) || 0) + (s.quantity || 1))

  const dishes = groupDishes(items).map((g) => dishView(g, costingById, soldById, now))
  const sections = []
  for (const it of items) if (it.menu_section && !sections.includes(it.menu_section)) sections.push(it.menu_section)
  return {
    restaurant,
    now: now.toISOString(),
    dayEnd: untilFor('day', restaurant.timezone, now),
    sections,
    dishes,
  }
}

const PRIORITIES = new Set([0, 1, 2, 3])

// Действия над блюдами (ids — все строки меню блюда):
//   stop     {ids, until: 'day'|'forever', note?}
//   unstop   {ids}
//   urgent   {ids, note?}            — «срочно продать» до конца дня
//   unurgent {ids}
//   priority {ids, priority: 0–3, reason?}
export async function kitchenAction(restaurantId, body) {
  const restaurant = await restaurantOf(restaurantId)
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : []
  if (ids.length === 0) throw httpError(400, 'Не выбраны блюда')
  if (ids.length > 1000) throw httpError(400, 'Слишком много блюд за раз')
  const own = await selectIn('menu_items', 'id, cost_rub', 'id', ids, (q) => q.eq('restaurant_id', restaurantId))
  if (own.length !== ids.length) throw httpError(400, 'Блюдо не из этого ресторана')
  const note = (v) => (v == null ? null : String(v).trim().slice(0, 200) || null)
  const now = deps.now()

  const updateMenu = async (fields) => {
    const { error } = await deps.db.from('menu_items').update(fields).in('id', ids).eq('restaurant_id', restaurantId)
    if (error) throw error
  }

  switch (body.action) {
    case 'stop': {
      if (body.until !== 'day' && body.until !== 'forever') throw httpError(400, 'Укажите срок: до конца дня или до отмены')
      await updateMenu({ stop_until: untilFor(body.until, restaurant.timezone, now), stop_note: note(body.note) })
      break
    }
    case 'unstop':
      await updateMenu({ stop_until: null, stop_note: null })
      break
    case 'urgent':
      await updateMenu({ urgent_until: untilFor('day', restaurant.timezone, now), urgent_note: note(body.note) })
      break
    case 'unurgent':
      await updateMenu({ urgent_until: null, urgent_note: null })
      break
    case 'priority': {
      const p = Number(body.priority)
      if (!PRIORITIES.has(p)) throw httpError(400, 'Приоритет — от 0 до 3')
      const reason = p > 0 ? note(body.reason) : null
      const existing = new Set((await selectIn('menu_item_costing', 'dish_id', 'dish_id', ids)).map((c) => c.dish_id))
      const toUpdate = ids.filter((id) => existing.has(id))
      const toInsert = own.filter((m) => !existing.has(m.id))
      if (toUpdate.length) {
        const { error } = await deps.db.from('menu_item_costing')
          .update({ push_priority: p, push_reason: reason, updated_at: now.toISOString() }).in('dish_id', toUpdate)
        if (error) throw error
      }
      if (toInsert.length) {
        const { error } = await deps.db.from('menu_item_costing').insert(toInsert.map((m) => ({
          dish_id: m.id, restaurant_id: restaurantId, sale_price: Number(m.cost_rub || 0),
          push_priority: p, push_reason: reason, source: 'manual', cost_method: 'manual',
        })))
        if (error) throw error
      }
      break
    }
    default:
      throw httpError(400, 'Неизвестное действие')
  }
  return { updated: ids.length }
}

// Долго готовились — за период (дни ресторана, включительно).
export async function getSlowDishes(restaurantId, fromStr, toStr) {
  const restaurant = await restaurantOf(restaurantId)
  const tz = restaurant.timezone
  const today = businessDateOf(deps.now(), tz)
  const period = normalizePeriod(fromStr, toStr, today)
  const range = { from: businessDay(period.from, tz).from, to: businessDay(period.to, tz).to }
  const menu = await menuOf(restaurantId)
  const dishById = new Map(menu.map((m) => [m.id, m]))
  const items = await selectIn('order_items', 'id, order_id, item_id, quantity, sent_at, ready_at', 'item_id', menu.map((m) => m.id),
    (q) => q.gte('ready_at', range.from.toISOString()).lt('ready_at', range.to.toISOString()))
  const report = slowReport(items, dishById)

  // Стол для каждой запоздавшей позиции.
  const orders = await selectIn('orders', 'id, table_number', 'id', report.lateItems.map((i) => i.orderId))
  const tableOf = new Map(orders.map((o) => [o.id, o.table_number]))
  report.lateItems = report.lateItems.map((i) => ({ ...i, tableNumber: tableOf.get(i.orderId) ?? null }))

  return { restaurant, today, period: { from: period.from, to: period.to, days: period.days.length }, ...report }
}
