import { supabase } from './supabase'

export type LoadedOrderItem = {
  id: string
  item_id: string
  seat_number: number
  quantity: number
  unit_price: number
  status: string
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
  await supabase.from('order_items').update({ status: 'sent' }).eq('order_id', orderId).neq('status', 'sent')
  await supabase.from('orders').update({ status: 'cooking' }).eq('id', orderId)
}

export async function requestBill(orderId: string): Promise<void> {
  await supabase.from('orders').update({ status: 'bill_requested' }).eq('id', orderId)
}

export async function clearTable(orderId: string): Promise<void> {
  await supabase.from('orders').update({ status: 'paid' }).eq('id', orderId)
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

export async function loadOrderItems(orderId: string): Promise<LoadedOrderItem[]> {
  const { data: items, error } = await supabase
    .from('order_items')
    .select('id, item_id, seat_number, quantity, unit_price, status, comment')
    .eq('order_id', orderId)
    .order('seat_number')
    .order('id')

  if (error || !items?.length) return []

  const itemIds = [...new Set(items.map(i => i.item_id))]
  const orderItemIds = items.map(i => i.id)

  const [{ data: menuItems }, { data: oims }] = await Promise.all([
    supabase.from('menu_items').select('id, dish_name, cook_time_min').in('id', itemIds),
    supabase.from('order_item_modifiers').select('order_item_id, modifier_id, price_delta').in('order_item_id', orderItemIds),
  ])

  const modifierIds = [...new Set((oims || []).map(m => m.modifier_id))]
  const { data: modData } = modifierIds.length
    ? await supabase.from('modifiers').select('id, name, group_id').in('id', modifierIds)
    : { data: [] as { id: string; name: string; group_id: string }[] }

  const groupIds = [...new Set((modData || []).map(m => m.group_id).filter(Boolean))]
  const { data: groupData } = groupIds.length
    ? await supabase.from('modifier_groups').select('id, name').in('id', groupIds)
    : { data: [] as { id: string; name: string }[] }

  const dishMap = Object.fromEntries((menuItems || []).map(m => [m.id, m]))
  const groupMap = Object.fromEntries((groupData || []).map(g => [g.id, g.name]))
  const modMap = Object.fromEntries((modData || []).map(m => [m.id, { name: m.name, groupName: groupMap[m.group_id] ?? '' }]))

  return items.map(item => ({
    id: item.id,
    item_id: item.item_id,
    seat_number: item.seat_number,
    quantity: item.quantity,
    unit_price: item.unit_price,
    status: item.status,
    comment: item.comment ?? null,
    dish_name: dishMap[item.item_id]?.dish_name ?? '?',
    cook_time_min: dishMap[item.item_id]?.cook_time_min ?? 0,
    modifiers: (oims || [])
      .filter(m => m.order_item_id === item.id)
      .map(m => ({
        groupName: modMap[m.modifier_id]?.groupName ?? '',
        name: modMap[m.modifier_id]?.name ?? '',
        price_delta: m.price_delta,
      })),
  }))
}
