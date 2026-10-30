// Раздел «Брони» в админке — чтение из БД (под service_role).
// Гостя узнаём по телефону брони: зарегистрирован в приложении (guests,
// телефон подтверждён SMS) — берём его заказы по местам; нет — его прошлые
// брони с этим номером и посадки, в которые они превратились. Всё — только
// в ЭТОМ ресторане: визиты гостя в другие рестораны платформы не показываем.

import { deps, selectAll, selectIn, restaurantOf, tablesOf, waitersByIds, groupBy, httpError, layoutOf, reservationView } from './hallService.js'
import { zonesOf } from './zonesService.js'
import { businessDay, businessDateOf, addDays, isDateStr, orderItemsTotal, waiterName } from './hallCore.js'
import {
  BOOKING_DAYS_AHEAD, normalizePhone, phoneVariants, guestHistory, guestBadges, loyaltyDemo, bookingDates,
} from './bookingsCore.js'

const ACTIVE = new Set(['confirmed', 'seated'])
const RES_COLS = 'id, table_id, starts_at, ends_at, guest_count, guest_name, guest_phone, comment, status, created_at'
// История броней гостя — за год назад.
const HISTORY_DAYS = 365

const missingColumn = (e) => e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist/i.test(e.message || ''))

// Гости приложения по номерам: phone → строка guests.
async function appGuests(phones) {
  const variants = phones.flatMap(phoneVariants)
  if (!variants.length) return new Map()
  const rows = await selectIn('guests', 'id, name, phone, device_id, points, birthday_day, birthday_month, dislikes, created_at', 'phone', variants)
  const out = new Map()
  for (const g of rows) {
    const p = normalizePhone(g.phone)
    if (p && !out.has(p)) out.set(p, g)
  }
  return out
}

// Визиты гостей приложения в ресторане: что заказал каждый на своём месте.
async function appVisits(restaurantId, guests, tableById) {
  const guestIds = [...guests.values()].map((g) => g.id)
  if (!guestIds.length) return new Map()
  const devRows = await selectIn('guest_devices', 'device_id, guest_id', 'guest_id', guestIds)
  const guestOfDevice = new Map(devRows.map((d) => [d.device_id, d.guest_id]))
  for (const g of guests.values()) if (g.device_id) guestOfDevice.set(g.device_id, g.id)

  const seats = await selectIn('order_guests', 'order_id, seat_number, device_id', 'device_id', [...guestOfDevice.keys()])
  const orders = await selectIn('orders', 'id, table_id, table_session_id, status, created_at', 'id', seats.map((s) => s.order_id),
    (q) => q.eq('restaurant_id', restaurantId))
  const orderById = new Map(orders.filter((o) => o.status !== 'cancelled').map((o) => [o.id, o]))
  const mine = seats.filter((s) => orderById.has(s.order_id))
  const items = await selectIn('order_items', 'id, order_id, item_id, seat_number, quantity, unit_price, status', 'order_id', mine.map((s) => s.order_id))
  const modsByItem = groupBy(await selectIn('order_item_modifiers', 'order_item_id, price_delta', 'order_item_id', items.map((i) => i.id)), 'order_item_id')
  const sessions = await selectIn('table_sessions', 'id, table_id, waiter_id, guest_count, started_at', 'id', orders.map((o) => o.table_session_id))
  const sessionById = new Map(sessions.map((s) => [s.id, s]))
  const names = await dishNames(items.map((i) => i.item_id))

  // Визит — посадка (или заказ, если посадка не записана).
  const byGuest = new Map()
  for (const seat of mine) {
    const gid = guestOfDevice.get(seat.device_id)
    const o = orderById.get(seat.order_id)
    const sess = sessionById.get(o.table_session_id)
    const key = o.table_session_id || o.id
    const visits = byGuest.get(gid) || new Map()
    const v = visits.get(key) || {
      id: key,
      sessionId: o.table_session_id || null,
      startedAt: sess?.started_at || o.created_at,
      tableNumber: tableById.get(sess?.table_id || o.table_id)?.number ?? null,
      waiterId: sess?.waiter_id || null,
      guestCount: sess?.guest_count || null,
      spent: 0,
      items: [],
      scope: 'seat',
    }
    for (const it of items) {
      if (it.order_id !== seat.order_id || it.seat_number !== seat.seat_number || it.status === 'cancelled') continue
      v.spent += orderItemsTotal([it], modsByItem)
      v.items.push({ name: names.get(it.item_id) || 'Блюдо удалено из меню', quantity: it.quantity || 1 })
    }
    visits.set(key, v)
    byGuest.set(gid, visits)
  }
  return byGuest
}

async function dishNames(ids) {
  const rows = await selectIn('menu_items', 'id, dish_name', 'id', ids)
  return new Map(rows.map((d) => [d.id, d.dish_name]))
}

// Посадки, в которые превратились брони «пришли»: тот же стол, гости сели
// за час до начала брони или во время неё. Счёт — всего стола.
async function reservationVisits(restaurantId, reservations, tableById) {
  const seated = reservations.filter((r) => r.status === 'seated' && r.table_id)
  if (!seated.length) return new Map()
  const from = new Date(Math.min(...seated.map((r) => new Date(r.starts_at).getTime())) - 3600_000).toISOString()
  const to = new Date(Math.max(...seated.map((r) => new Date(r.ends_at).getTime()))).toISOString()
  const sessions = await selectIn('table_sessions', 'id, table_id, waiter_id, guest_count, started_at', 'table_id', seated.map((r) => r.table_id),
    (q) => q.gte('started_at', from).lt('started_at', to))
  const orders = await selectIn('orders', 'id, table_session_id, status', 'table_session_id', sessions.map((s) => s.id))
  const live = orders.filter((o) => o.status !== 'cancelled')
  const items = await selectIn('order_items', 'id, order_id, item_id, quantity, unit_price, status', 'order_id', live.map((o) => o.id))
  const mods = await selectIn('order_item_modifiers', 'order_item_id, price_delta', 'order_item_id', items.map((i) => i.id))
  const modsByItem = groupBy(mods, 'order_item_id')
  const names = await dishNames(items.map((i) => i.item_id))
  const itemsByOrder = groupBy(items.filter((i) => i.status !== 'cancelled'), 'order_id')
  const ordersBySession = groupBy(live, 'table_session_id')

  const out = new Map() // reservation id → visit
  for (const r of seated) {
    const s = sessions
      .filter((x) => x.table_id === r.table_id
        && new Date(x.started_at) >= new Date(new Date(r.starts_at).getTime() - 3600_000)
        && new Date(x.started_at) < new Date(r.ends_at))
      .sort((a, b) => Math.abs(new Date(a.started_at) - new Date(r.starts_at)) - Math.abs(new Date(b.started_at) - new Date(r.starts_at)))[0]
    if (!s) continue
    const its = (ordersBySession.get(s.id) || []).flatMap((o) => itemsByOrder.get(o.id) || [])
    out.set(r.id, {
      id: s.id,
      sessionId: s.id,
      startedAt: s.started_at,
      tableNumber: tableById.get(s.table_id)?.number ?? null,
      waiterId: s.waiter_id || null,
      guestCount: s.guest_count || r.guest_count || null,
      spent: orderItemsTotal(its, modsByItem),
      items: its.map((it) => ({ name: names.get(it.item_id) || 'Блюдо удалено из меню', quantity: it.quantity || 1 })),
      scope: 'table',
    })
  }
  return out
}

// Карточки гостей по номерам: приложение, визиты, брони, демо-лояльность.
async function guestCards(restaurantId, phones, { tz, tables, now }) {
  const uniq = [...new Set(phones.filter(Boolean))]
  if (!uniq.length) return new Map()
  const tableById = new Map(tables.map((t) => [t.id, t]))

  // Все брони ресторана за год назад и месяц вперёд — номера в них
  // записаны по-разному, сравниваем после приведения к одному виду.
  const since = new Date(now.getTime() - HISTORY_DAYS * 86400_000).toISOString()
  const until = businessDay(addDays(businessDateOf(now, tz), BOOKING_DAYS_AHEAD), tz).to.toISOString()
  const allRes = await selectAll(() => deps.db.from('table_reservations').select(RES_COLS)
    .eq('restaurant_id', restaurantId)
    .gte('starts_at', since).lt('starts_at', until).order('starts_at'))
  const resByPhone = new Map()
  for (const r of allRes) {
    const p = normalizePhone(r.guest_phone)
    if (!p || !uniq.includes(p)) continue
    if (!resByPhone.has(p)) resByPhone.set(p, [])
    resByPhone.get(p).push(r)
  }

  const guests = await appGuests(uniq)
  const [seatVisits, resVisits, stats] = await Promise.all([
    appVisits(restaurantId, guests, tableById),
    reservationVisits(restaurantId, [...resByPhone.values()].flat(), tableById),
    selectIn('guest_restaurant_stats', 'guest_id, tags, top_dishes', 'guest_id', [...guests.values()].map((g) => g.id),
      (q) => q.eq('restaurant_id', restaurantId)).catch(() => []),
  ])
  const statsByGuest = new Map(stats.map((s) => [s.guest_id, s]))

  const out = new Map()
  for (const phone of uniq) {
    const g = guests.get(phone) || null
    const reservations = (resByPhone.get(phone) || []).map((r) => ({ ...reservationView(r), createdAt: r.created_at }))
    // Визиты: свои места (гость приложения) + посадки по броням, без повторов.
    const visits = new Map(g ? seatVisits.get(g.id) || [] : [])
    for (const r of resByPhone.get(phone) || []) {
      const v = resVisits.get(r.id)
      if (v && !visits.has(v.id)) visits.set(v.id, v)
    }
    const history = guestHistory({ visits: [...visits.values()], reservations, now })
    if (!g && !reservations.length) continue
    const lastNamed = [...reservations].reverse().find((r) => r.guestName)
    const st = g ? statsByGuest.get(g.id) : null
    out.set(phone, {
      phone,
      name: g?.name || lastNamed?.guestName || null,
      app: g && {
        guestId: g.id,
        name: g.name || null,
        since: g.created_at || null,
        points: g.points || 0,
        birthdayDay: g.birthday_day || null,
        birthdayMonth: g.birthday_month || null,
        dislikes: g.dislikes || null,
      },
      tastes: st?.tags && typeof st.tags === 'object'
        ? Object.entries(st.tags).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tag]) => tag)
        : [],
      history,
      visits: [...visits.values()].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt))),
      reservations,
      loyalty: loyaltyDemo({ visits: history.visits, spent: history.spent, appRegistered: !!g }),
    })
  }
  return out
}

function dateContext(restaurant, dateStr) {
  const today = businessDateOf(deps.now(), restaurant.timezone)
  const maxDate = addDays(today, BOOKING_DAYS_AHEAD)
  let date = isDateStr(dateStr) ? dateStr : today
  if (date < today) date = today
  if (date > maxDate) date = maxDate
  return { today, maxDate, date }
}

// Брони на дату: столы со своими бронями и отметками гостей, календарь месяца.
export async function getBookings(restaurantId, dateStr) {
  const restaurant = await restaurantOf(restaurantId)
  const tz = restaurant.timezone
  const now = deps.now()
  const { today, maxDate, date } = dateContext(restaurant, dateStr)
  const tables = await tablesOf(restaurantId)

  const month = await selectAll(() => deps.db.from('table_reservations').select(RES_COLS)
    .eq('restaurant_id', restaurantId)
    .gte('starts_at', businessDay(today, tz).from.toISOString())
    .lt('starts_at', businessDay(maxDate, tz).to.toISOString())
    .order('starts_at'))
  const withDate = month.map((r) => ({ ...r, date: businessDateOf(new Date(r.starts_at), tz) }))

  const cards = await guestCards(restaurantId, withDate.map((r) => normalizePhone(r.guest_phone)), { tz, tables, now })
  const view = (r) => {
    const phone = normalizePhone(r.guest_phone)
    return { ...reservationView(r), guest: guestBadges(phone ? cards.get(phone) : null, r.date) }
  }

  const calendar = bookingDates(today).map((d) => {
    const rows = withDate.filter((r) => r.date === d && ACTIVE.has(r.status))
    return {
      date: d,
      reservations: rows.length,
      guests: rows.reduce((s, r) => s + (r.guest_count || 0), 0),
      known: rows.filter((r) => guestBadges(cards.get(normalizePhone(r.guest_phone)), d).known).length,
    }
  })

  const day = withDate.filter((r) => r.date === date)
  const byTable = groupBy(day, 'table_id')
  const zoneList = (await zonesOf(restaurantId, tables)).zones
  const tableById = new Map(tables.map((t) => [t.id, t]))
  return {
    restaurant,
    today,
    maxDate,
    date,
    calendar,
    zones: zoneList.map((z) => z.key),
    zoneNames: Object.fromEntries(zoneList.map((z) => [z.key, z.name])),
    tables: tables.map((t) => ({
      id: t.id, number: t.number, zone: t.zone || 'main', capacity: t.capacity, layout: layoutOf(t),
      reservations: (byTable.get(t.id) || []).map(view),
    })),
    reservations: day
      .map((r) => ({ ...view(r), tableNumber: tableById.get(r.table_id)?.number ?? null }))
      .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
  }
}

// Карточка гостя по номеру телефона брони.
export async function getBookingGuest(restaurantId, rawPhone) {
  const phone = normalizePhone(rawPhone)
  if (!phone) throw httpError(400, 'Неверный номер телефона')
  const restaurant = await restaurantOf(restaurantId)
  const tz = restaurant.timezone
  const now = deps.now()
  const tables = await tablesOf(restaurantId, { includeInactive: true })
  const card = (await guestCards(restaurantId, [phone], { tz, tables, now })).get(phone)
  if (!card) return { restaurant, phone, found: false }

  const waiters = await waitersByIds([...card.history.waiters.map((w) => w.id), ...card.visits.map((v) => v.waiterId)])
  // Отзывы гостя — по его посадкам (если отзывы уже привязаны к посадке).
  let reviews = []
  const sessionIds = card.visits.map((v) => v.sessionId).filter(Boolean)
  if (sessionIds.length) {
    try {
      reviews = await selectIn('reviews', 'id, created_at, rating_food, rating_service, comment, session_id', 'session_id', sessionIds,
        (q) => q.eq('restaurant_id', restaurantId))
    } catch (e) {
      if (!missingColumn(e)) throw e
    }
  }
  const today = businessDateOf(now, tz)
  return {
    restaurant,
    found: true,
    ...card,
    history: {
      ...card.history,
      waiters: card.history.waiters.map((w) => ({ ...w, name: waiterName(waiters.get(w.id)) })),
    },
    visits: card.visits.slice(0, 15).map((v) => ({ ...v, date: businessDateOf(new Date(v.startedAt), tz), waiterName: v.waiterId ? waiterName(waiters.get(v.waiterId)) : null })),
    upcoming: card.reservations.filter((r) => businessDateOf(new Date(r.startsAt), tz) >= today && ACTIVE.has(r.status)),
    reservations: [...card.reservations].reverse().slice(0, 20),
    reviews: reviews
      .map((r) => ({ id: r.id, createdAt: r.created_at, food: r.rating_food || null, service: r.rating_service || null, comment: (r.comment || '').trim() || null }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  }
}
