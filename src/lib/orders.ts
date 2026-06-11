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
  modifiers: { name: string; price_delta: number }[]
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
): Promise<string> {
  const hasModifiers = modifiers.length > 0

  if (!hasModifiers) {
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
    .insert({ order_id: orderId, item_id: itemId, seat_number: seatNumber, quantity: 1, unit_price: unitPrice })
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

export async function loadOrderItems(orderId: string): Promise<LoadedOrderItem[]> {
  const { data: items, error } = await supabase
    .from('order_items')
    .select('id, item_id, seat_number, quantity, unit_price, status')
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
    ? await supabase.from('modifiers').select('id, name').in('id', modifierIds)
    : { data: [] as { id: string; name: string }[] }

  const dishMap = Object.fromEntries((menuItems || []).map(m => [m.id, m]))
  const modMap = Object.fromEntries((modData || []).map(m => [m.id, m.name]))

  return items.map(item => ({
    id: item.id,
    item_id: item.item_id,
    seat_number: item.seat_number,
    quantity: item.quantity,
    unit_price: item.unit_price,
    status: item.status,
    dish_name: dishMap[item.item_id]?.dish_name ?? '?',
    cook_time_min: dishMap[item.item_id]?.cook_time_min ?? 0,
    modifiers: (oims || [])
      .filter(m => m.order_item_id === item.id)
      .map(m => ({ name: modMap[m.modifier_id] ?? '', price_delta: m.price_delta })),
  }))
}
