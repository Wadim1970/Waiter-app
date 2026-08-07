import { supabaseWaiter } from './supabase'

export interface WaiterCall {
  id: string
  restaurant_id: string
  table_id: string
  table_number: string
  target_waiter_id: string | null
  // 'service'   — обычный вызов (кнопка-колокольчик у гостя);
  // 'age_check' — гость заказал алкоголь, нужно подтвердить возраст.
  kind: 'service' | 'age_check'
  status: 'pending' | 'acknowledged' | 'cancelled' | 'confirmed' | 'declined'
  reason: string | null
  created_at: string
}

// Realtime не умеет OR/IS NULL в filter (только одно равенство), поэтому
// подписка идёт по restaurant_id — виден весь трафик ресторана — а решение
// "моя ли это цель" принимается уже на клиенте: либо вызов ничей конкретно
// (широковещательный, target_waiter_id === null), либо назначен именно мне.
export function isCallForMe(call: WaiterCall, myWaiterId: string): boolean {
  return call.target_waiter_id === null || call.target_waiter_id === myWaiterId
}

// Ловит вызовы, пропущенные, пока приложение было в фоне (вкладка
// свёрнута — realtime-соединение браузер мог оборвать, INSERT-событие
// за это время не долетит никогда, задним числом Realtime его не отдаёт).
// Вызывается и при монтировании, и при возврате видимости — без этого
// официант, вернувшись в приложение, не видел вызовы, случившиеся, пока
// он был в другом приложении (главный баг, который это чинит).
export async function fetchPendingCalls(restaurantId: string): Promise<WaiterCall[]> {
  const { data, error } = await supabaseWaiter
    .from('waiter_calls')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as WaiterCall[]
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

// Подтверждение возраста (kind='age_check'): официант проверил возраст гостя.
// confirm → статус 'confirmed', устройство гостя по Realtime отправляет заказ
// на кухню; decline → 'declined', гость убирает алкоголь и оформляет заново.
// Гонка как у acknowledge: побеждает первый, остальным вернётся false.
export async function confirmAgeCheck(callId: string, waiterId: string): Promise<boolean> {
  const { data, error } = await supabaseWaiter.rpc('confirm_age_check', {
    p_call_id: callId,
    p_waiter_id: waiterId,
  })
  if (error) throw error
  return !!data
}

export async function declineAgeCheck(callId: string, waiterId: string): Promise<boolean> {
  const { data, error } = await supabaseWaiter.rpc('decline_age_check', {
    p_call_id: callId,
    p_waiter_id: waiterId,
  })
  if (error) throw error
  return !!data
}
