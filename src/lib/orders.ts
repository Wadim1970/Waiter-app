import { supabase } from './supabase'

export type LoadedOrderItem = {
  id: string
  item_id: string
  seat_number: number
  quantity: number
  unit_price: number
  status: string
  sent_at: string | null
  dish_name: string
  cook_time_min: number
  comment: string | null
  modifiers: { groupName: string; name: string; price_delta: number }[]
}

export async function getOrderStatus(orderId: string): Promise<string | null> {
  const { data } = await supabase.from('orders').select('status').eq('id', orderId).maybeSingle()
  return data?.status ?? null
}

export async function sendToKitchen(orderId: string): Promise<void> {
  await supabase
    .from('order_items')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .neq('status', 'sent')
  await supabase.from('orders').update({ status: 'cooking' }).eq('id', orderId)
}

export async function requestBill(orderId: string): Promise<void> {
  await supabase.from('orders').update({ status: 'bill_requested' }).eq('id', orderId)
}

export async function clearTable(orderId: string): Promise<void> {
  await supabase.from('orders').update({ status: 'paid' }).eq('id', orderId)
}

export async function updateTableSessionStatus(
  tableId: string,
  status: 'free' | 'occupied' | 'preparing' | 'resting' | 'bill_requested' | 'call',
  guestCount?: number,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('table_sessions')
    .select('id')
    .eq('table_id', tableId)
    .eq('is_active', true)
    .maybeSingle()

  if (existing) {
    const updates: Record<string, unknown> = { status }
    if (status === 'free') {
      updates.is_active = false
      updates.ended_at = new Date().toISOString()
    }
    if (guestCount !== undefined) updates.guest_count = guestCount
    await supabase.from('table_sessions').update(updates).eq('id', existing.id)
    return existing.id
  } else if (status !== 'free') {
    const { data } = await supabase
      .from('table_sessions')
      .insert({
        table_id: tableId, status, is_active: true,
        started_at: new Date().toISOString(),
        ...(guestCount !== undefined ? { guest_count: guestCount } : {}),
      })
      .select('id')
      .single()
    return data?.id ?? null
  }
  return null
}

export async function markItemReady(itemId: string): Promise<void> {
  await supabase.from('order_items').update({ status: 'ready' }).eq('id', itemId)
}

export async function markGuestPaid(orderId: string, seatNumber: number): Promise<void> {
  await supabase.from('order_guests').update({ status: 'paid' }).eq('order_id', orderId).eq('seat_number', seatNumber)
}

export async function getGuestPaidStatus(orderId: string): Promise<Record<number, string>> {
  const { data } = await supabase.from('order_guests').select('seat_number, status').eq('order_id', orderId)
  if (!data?.length) return {}
  return Object.fromEntries(data.map(r => [r.seat_number, r.status]))
}

export async function getOrCreateOrder(
  tableId: string,
  tableNumber: number,
  restaurantId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('table_id', tableId)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'new')
    .maybeSingle()

  if (existing?.id) return existing.id

  const { data, error } = await supabase
    .from('orders')
    .insert({
      table_id: tableId,
      table_number: String(tableNumber),
      restaurant_id: restaurantId,
      status: 'new',
      total_amount: 0,
      items: [],
    })
    .select('id')
    .single()

  if (error) throw error
  return data.id
}

export async function addOrderItem(
  orderId: string,
  itemId: string,
  seatNumber: number,
  unitPrice: number,
  modifiers: { modifierId: string; priceDelta: number }[],
  comment?: string,
): Promise<string> {
  const hasModifiers = modifiers.length > 0

  if (!hasModifiers && !comment) {
    const { data: existing } = await supabase
      .from('order_items')
      .select('id, quantity')
      .eq('order_id', orderId)
      .eq('item_id', itemId)
      .eq('seat_number', seatNumber)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('order_items')
        .update({ quantity: existing.quantity + 1 })
        .eq('id', existing.id)
      return existing.id
    }
  }

  const { data: newItem, error } = await supabase
    .from('order_items')
    .insert({
      order_id: orderId,
      item_id: itemId,
      seat_number: seatNumber,
      quantity: 1,
      unit_price: unitPrice,
      status: 'new',
      comment: comment || null,
    })
    .select('id')
    .single()

  if (error) throw error

  if (hasModifiers) {
    await supabase.from('order_item_modifiers').insert(
      modifiers.map(m => ({ order_item_id: newItem.id, modifier_id: m.modifierId, price_delta: m.priceDelta }))
    )
  }

  return newItem.id
}

export async function removeOrderItem(dbId: string, currentQuantity: number): Promise<void> {
  if (currentQuantity > 1) {
    await supabase.from('order_items').update({ quantity: currentQuantity - 1 }).eq('id', dbId)
  } else {
    await supabase.from('order_item_modifiers').delete().eq('order_item_id', dbId)
    await supabase.from('order_items').delete().eq('id', dbId)
  }
}

export type GuestAttrs = { gender: string | null; age: string | null; body: string | null; hair: string | null }

export async function saveGuestAttributes(
  orderId: string,
  seatNumber: number,
  attrs: GuestAttrs,
): Promise<void> {
  await supabase.from('order_guests').upsert(
    { order_id: orderId, seat_number: seatNumber, ...attrs },
    { onConflict: 'order_id,seat_number' },
  )
}

export async function loadGuestAttributes(orderId: string): Promise<Record<number, GuestAttrs>> {
  const { data } = await supabase
    .from('order_guests')
    .select('seat_number, gender, age, body, hair')
    .eq('order_id', orderId)

  if (!data?.length) return {}
  return Object.fromEntries(
    data.map(r => [r.seat_number, { gender: r.gender, age: r.age, body: r.body, hair: r.hair }])
  )
}

// Один вложенный PostgREST-запрос вместо прежних 4-5 последовательных
// round-trip'ов (order_items → menu_items + order_item_modifiers → modifiers
// → modifier_groups). Работает благодаря существующим FK: order_items.item_id
// -> menu_items.id, order_item_modifiers.order_item_id -> order_items.id,
// order_item_modifiers.modifier_id -> modifiers.id, modifiers.group_id ->
// modifier_groups.id — PostgREST сам строит JOIN по этим связям.
export async function loadOrderItems(orderId: string): Promise<LoadedOrderItem[]> {
  const { data: items, error } = await supabase
    .from('order_items')
    .select(`
      id, item_id, seat_number, quantity, unit_price, status, sent_at, comment,
      menu_items ( dish_name, cook_time_min ),
      order_item_modifiers (
        price_delta,
        modifiers ( name, modifier_groups ( name ) )
      )
    `)
    .eq('order_id', orderId)
    .order('seat_number')
    .order('id')

  if (error || !items?.length) return []

  return (items as any[]).map(item => ({
    id: item.id,
    item_id: item.item_id,
    seat_number: item.seat_number,
    quantity: item.quantity,
    unit_price: item.unit_price,
    status: item.status,
    sent_at: item.sent_at ?? null,
    comment: item.comment ?? null,
    dish_name: item.menu_items?.dish_name ?? '?',
    cook_time_min: item.menu_items?.cook_time_min ?? 0,
    modifiers: (item.order_item_modifiers ?? []).map((m: any) => ({
      groupName: m.modifiers?.modifier_groups?.name ?? '',
      name: m.modifiers?.name ?? '',
      price_delta: m.price_delta,
    })),
  }))
}
