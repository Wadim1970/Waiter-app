import { supabaseWaiter } from './supabase'

export interface WaiterCall {
  id: string
  restaurant_id: string
  table_id: string
  table_number: string
  target_waiter_id: string | null
  status: 'pending' | 'acknowledged'
  created_at: string
}

// Realtime не умеет OR/IS NULL в filter (только одно равенство), поэтому
// подписка идёт по restaurant_id — виден весь трафик ресторана — а решение
// "моя ли это цель" принимается уже на клиенте: либо вызов ничей конкретно
// (широковещательный, target_waiter_id === null), либо назначен именно мне.
export function isCallForMe(call: WaiterCall, myWaiterId: string): boolean {
  return call.target_waiter_id === null || call.target_waiter_id === myWaiterId
}

export function subscribeToWaiterCalls(
  restaurantId: string,
  onNewCall: (call: WaiterCall) => void,
  onCallResolved: (call: WaiterCall) => void
) {
  const channel = supabaseWaiter
    .channel(`waiter_calls:${restaurantId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => onNewCall(payload.new as WaiterCall)
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'waiter_calls', filter: `restaurant_id=eq.${restaurantId}` },
      (payload) => onCallResolved(payload.new as WaiterCall)
    )
    .subscribe()

  return () => { supabaseWaiter.removeChannel(channel) }
}

// true, если именно этот клик "выиграл" гонку (взял вызов первым) — не
// критично для UI (событие UPDATE придёт всем через Realtime в любом
// случае), но полезно для логов/отладки.
export async function acknowledgeWaiterCall(callId: string, waiterId: string): Promise<boolean> {
  const { data, error } = await supabaseWaiter.rpc('acknowledge_waiter_call', {
    p_call_id: callId,
    p_waiter_id: waiterId,
  })
  if (error) throw error
  return !!data
}
