import { supabase } from './supabase'

// Комментарий к заказу (таблица order_comments, миграция 20261030010000):
// гость пишет при отправке заказа, официант — сам. seat_number = null — ко всему столу.
export interface OrderComment {
  id: string
  order_id: string
  seat_number: number | null
  author: 'guest' | 'waiter'
  body: string
  created_at: string
  acknowledged_at: string | null
}

const COLUMNS = 'id, order_id, seat_number, author, body, created_at, acknowledged_at'

// Ошибка (например, миграция ещё не применена) — просто «комментариев нет»,
// экраны заказа продолжают работать.
export async function loadOrderComments(orderId: string): Promise<OrderComment[]> {
  const { data, error } = await supabase
    .from('order_comments')
    .select(COLUMNS)
    .eq('order_id', orderId)
    .order('created_at')
  if (error || !data) return []
  return data as OrderComment[]
}

export async function addOrderComment(orderId: string, seat: number | null, body: string): Promise<void> {
  const { error } = await supabase.rpc('add_order_comment', { p_order_id: orderId, p_seat: seat, p_body: body })
  if (error) throw error
}

export async function ackOrderComment(id: string, acknowledged: boolean): Promise<void> {
  const { error } = await supabase.rpc('ack_order_comment', { p_id: id, p_acknowledged: acknowledged })
  if (error) throw error
}
