// Совет к корзине гостя и напоминание о десерте — I/O (под service_role).
// Логика — cartAdviceCore.js и mealCore.js; меню, пары, приоритеты и профиль
// гостя — те же, что у пар блюд (pairingService.js).

import { deps, loadMenu, loadActivePairs, loadGuest, loadPriorities } from './pairingService.js'
import { dislikeMatcher } from './pairingCore.js'
import { categoryOf } from './suggestCore.js'
import { mealAt, roleOf, isFood, MEALS, MEAL_TO } from './mealCore.js'
import { adviseCart, dessertPicks, dessertDueAt } from './cartAdviceCore.js'

// Меню, пары и приоритеты ресторана держим в памяти минуту: корзину гость
// открывает часто, а меню за минуту не меняется (стоп — тоже не страшно).
const CTX_TTL_MS = 60_000
const cache = new Map()
export const resetCache = () => cache.clear()
export const clock = { now: () => new Date() }

async function context(restaurantId) {
  const hit = cache.get(restaurantId)
  if (hit && hit.until > Date.now()) return hit.ctx
  const [menu, pairs, rest] = await Promise.all([
    loadMenu(restaurantId),
    loadActivePairs(restaurantId).catch(() => []),
    deps.supabase.from('restaurants').select('timezone').eq('id', restaurantId).maybeSingle(),
  ])
  const priority = await loadPriorities(restaurantId, menu)
  const ctx = {
    menu: menu.map((m) => ({ ...m, priority: priority.get(m.id) || 0 })),
    pairs,
    tz: rest?.data?.timezone || 'Europe/Moscow',
  }
  cache.set(restaurantId, { ctx, until: Date.now() + CTX_TTL_MS })
  return ctx
}

const asLines = (list) => (Array.isArray(list) ? list : [])
  .map((x) => ({ id: String(x?.id || ''), quantity: Math.max(1, Number(x?.quantity) || 1) }))
  .filter((x) => x.id)
  .slice(0, 60)

const startOfWindow = () => new Date(clock.now().getTime() - 6 * 3600_000).toISOString()

// Про десерт в этот визит уже спрашивали (согласился или отказался).
async function dessertAsked(restaurantId, deviceId) {
  if (!deviceId) return false
  const { data, error } = await deps.supabase.from('guest_dessert_reminders').select('id')
    .eq('restaurant_id', restaurantId).eq('device_id', deviceId).gte('created_at', startOfWindow()).limit(1)
  if (error) return false // таблицы нет (миграция не применена) — просто спросим
  return (data || []).length > 0
}

async function blockedFor(deviceId) {
  const guest = deviceId ? await loadGuest(deviceId).catch(() => null) : null
  return dislikeMatcher(String(guest?.dislikes || ''))
}

// Совет к корзине: что добавить, или похвала и вопрос про десерт.
export async function cartAdvice({ restaurantId, deviceId, cart, ordered, dismissed }) {
  const ctx = await context(restaurantId)
  const [blocked, asked] = await Promise.all([blockedFor(deviceId), dessertAsked(restaurantId, deviceId)])
  return adviseCart({
    cart: asLines(cart),
    ordered: asLines(ordered),
    menu: ctx.menu,
    pairs: ctx.pairs,
    clockMeal: mealAt(clock.now(), ctx.tz),
    blocked,
    dismissed: {
      dishes: new Set(asLines(dismissed?.dishes?.map?.((id) => ({ id })) || []).map((x) => x.id)),
      gaps: new Set((Array.isArray(dismissed?.gaps) ? dismissed.gaps : []).map(String)),
    },
    dessertAsked: asked,
  })
}

const OUTCOMES = new Set(['accepted', 'rejected', 'ignored'])

// Что гость сделал с советом — в статистику подсказок (канал guest_cart).
export async function logAdviceEvent({ restaurantId, deviceId, dishId, anchorId, gap, outcome, source }) {
  if (!OUTCOMES.has(outcome)) return { logged: false }
  const ctx = await context(restaurantId)
  const dish = ctx.menu.find((m) => m.id === dishId)
  const { error } = await deps.supabase.from('ai_suggestion_events').insert({
    restaurant_id: restaurantId,
    dish_id: dish ? dishId : null,
    anchor_dish_id: ctx.menu.some((m) => m.id === anchorId) ? anchorId : null,
    device_id: deviceId || null,
    channel: 'guest_cart',
    tag: String(gap || '').slice(0, 40) || null,
    technique: source === 'pairing' ? 'taste_pairing' : null,
    source: source === 'pairing' ? 'pairing' : 'rule',
    category: dish ? categoryOf(dish) : (gap === 'dessert_ask' ? 'dessert' : null),
    outcome,
  })
  if (error) console.error('cart-advice: event failed', error.message)
  return { logged: !error }
}

async function tableByNumber(restaurantId, tableNumber) {
  const n = Number(tableNumber)
  if (!Number.isInteger(n)) return null
  const { data } = await deps.supabase.from('tables').select('id, number').eq('restaurant_id', restaurantId).eq('number', n).maybeSingle()
  return data || null
}

// Ответ гостя на «можно позже предложить десерт?».
export async function answerDessert({ restaurantId, deviceId, tableNumber, seat, meal, yes }) {
  if (!deviceId) return { saved: false }
  const table = await tableByNumber(restaurantId, tableNumber)
  const { error } = await deps.supabase.from('guest_dessert_reminders').insert({
    restaurant_id: restaurantId,
    device_id: deviceId,
    table_id: table?.id || null,
    table_number: table ? String(table.number) : (tableNumber ? String(tableNumber) : null),
    seat_number: Number.isInteger(Number(seat)) && Number(seat) > 0 ? Number(seat) : null,
    meal: MEALS.includes(meal) ? meal : null,
    status: yes ? 'pending' : 'declined',
  })
  if (error) throw error
  await logAdviceEvent({ restaurantId, deviceId, gap: 'dessert_ask', outcome: yes ? 'accepted' : 'rejected' })
  return { saved: true }
}

// Еда гостя за этим столом после согласия: что заказал на своём месте и
// когда это отметили готовым.
async function guestFood(rem, menu) {
  if (!rem.table_id) return []
  const since = new Date(new Date(rem.created_at).getTime() - 4 * 3600_000).toISOString()
  const { data: orders } = await deps.supabase.from('orders').select('id').eq('table_id', rem.table_id).gte('created_at', since)
  const orderIds = (orders || []).map((o) => o.id)
  if (!orderIds.length) return []
  const { data: seats } = await deps.supabase.from('order_guests').select('order_id, seat_number, device_id').in('order_id', orderIds).eq('device_id', rem.device_id)
  const mine = new Set((seats || []).map((s) => `${s.order_id}:${s.seat_number}`))
  if (!mine.size && rem.seat_number == null) return []
  const { data: items } = await deps.supabase.from('order_items').select('order_id, item_id, seat_number, status, ready_at').in('order_id', orderIds)
  const byId = new Map(menu.map((m) => [m.id, m]))
  return (items || [])
    .filter((it) => mine.has(`${it.order_id}:${it.seat_number}`) || (!mine.size && it.seat_number === rem.seat_number))
    .filter((it) => it.status !== 'cancelled' && it.status !== 'new' && byId.has(it.item_id) && isFood(roleOf(byId.get(it.item_id))))
    .map((it) => ({ readyAt: it.ready_at || null }))
}

async function tableStillOccupied(tableId) {
  if (!tableId) return true
  const { data } = await deps.supabase.from('table_sessions').select('id').eq('table_id', tableId).eq('is_active', true).limit(1)
  return (data || []).length > 0
}

// Кому из официантов адресовать: кто ведёт посадку, иначе единственный
// закреплённый за столом (как у колокольчика); иначе — всем.
async function targetWaiter(tableId) {
  const { data: sess } = await deps.supabase.from('table_sessions').select('waiter_id').eq('table_id', tableId).eq('is_active', true).limit(1)
  if (sess?.[0]?.waiter_id) return sess[0].waiter_id
  const { data: asg } = await deps.supabase.from('waiter_table_assignments').select('waiter_id, is_permanent, assigned_date').eq('table_id', tableId)
  const today = clock.now().toISOString().slice(0, 10)
  const ids = [...new Set((asg || []).filter((a) => a.is_permanent || a.assigned_date === today).map((a) => a.waiter_id))]
  return ids.length === 1 ? ids[0] : null
}

async function createDessertCall(rem) {
  const reason = rem.seat_number ? `Время десерта: гость на месте ${rem.seat_number} ждёт предложения` : 'Время десерта: гость ждёт предложения'
  const { data, error } = await deps.supabase.from('waiter_calls').insert({
    restaurant_id: rem.restaurant_id,
    table_id: rem.table_id,
    table_number: rem.table_number,
    target_waiter_id: await targetWaiter(rem.table_id),
    status: 'pending',
    reason,
    kind: 'dessert',
  }).select('id').single()
  if (!error) return data.id
  // Уже висит десертный вызов за этим столом (другой гость) — он и есть.
  const { data: existing } = await deps.supabase.from('waiter_calls').select('id')
    .eq('table_id', rem.table_id).eq('kind', 'dessert').eq('status', 'pending').limit(1)
  if (existing?.[0]?.id) return existing[0].id
  throw error
}

// Раз в минуту (cron): чьё время десерта пришло — вызвать официанта.
// pushUrl — сервер пушей официанта (тот же, что зовёт гостевое приложение).
export async function tickDessertReminders({ pushUrl } = {}) {
  const now = clock.now()
  const { data: rows, error } = await deps.supabase.from('guest_dessert_reminders').select('*').eq('status', 'pending')
  if (error) throw error
  const out = { checked: 0, called: 0, closed: 0, calls: [] }
  const menus = new Map()
  for (const rem of rows || []) {
    out.checked++
    const age = now - new Date(rem.created_at)
    if (age > 5 * 3600_000 || !(await tableStillOccupied(rem.table_id))) {
      await deps.supabase.from('guest_dessert_reminders').update({ status: 'closed' }).eq('id', rem.id)
      out.closed++
      continue
    }
    if (!menus.has(rem.restaurant_id)) menus.set(rem.restaurant_id, (await context(rem.restaurant_id)).menu)
    const due = dessertDueAt({ consentAt: rem.created_at, food: await guestFood(rem, menus.get(rem.restaurant_id)) })
    if (due > now) continue
    if (!rem.table_id) {
      // Стол неизвестен — официанта не позвать, напомним только гостю.
      await deps.supabase.from('guest_dessert_reminders').update({ status: 'called', due_at: due.toISOString(), called_at: now.toISOString() }).eq('id', rem.id)
      continue
    }
    const callId = await createDessertCall(rem)
    await deps.supabase.from('guest_dessert_reminders')
      .update({ status: 'called', due_at: due.toISOString(), called_at: now.toISOString(), call_id: callId }).eq('id', rem.id)
    out.called++
    out.calls.push(callId)
    if (pushUrl) {
      await fetch(`${String(pushUrl).replace(/\/$/, '')}/api/send-waiter-call-push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ callId }),
      }).catch((e) => console.error('dessert: push failed', e?.message || e))
    }
  }
  return out
}

// Гость открыл приложение: пора ли показать десерты (один раз).
export async function guestDessert({ restaurantId, deviceId }) {
  if (!deviceId) return { due: false }
  const { data, error } = await deps.supabase.from('guest_dessert_reminders').select('*')
    .eq('restaurant_id', restaurantId).eq('device_id', deviceId).in('status', ['pending', 'called'])
    .gte('created_at', startOfWindow()).order('created_at', { ascending: false }).limit(1)
  if (error) return { due: false }
  const rem = data?.[0]
  if (!rem || rem.shown_at) return { due: false }
  const ctx = await context(restaurantId)
  const due = rem.due_at ? new Date(rem.due_at) : dessertDueAt({ consentAt: rem.created_at, food: await guestFood(rem, ctx.menu) })
  if (due > clock.now()) return { due: false, at: due.toISOString() }
  const meal = MEALS.includes(rem.meal) ? rem.meal : mealAt(clock.now(), ctx.tz)
  const desserts = dessertPicks(ctx.menu, meal, await blockedFor(deviceId))
  await deps.supabase.from('guest_dessert_reminders').update({ shown_at: clock.now().toISOString() }).eq('id', rem.id)
  if (!desserts.length) return { due: false }
  return {
    due: true,
    title: 'Самое время для десерта',
    text: `Вы просили напомнить — вот что мы рекомендуем ${MEAL_TO[meal]}:`,
    desserts,
  }
}
