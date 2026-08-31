import { supabaseWaiter, getWaiterId } from './supabase'

export type SuggestionOutcome = 'accepted' | 'rejected' | 'ignored'

export type LogSuggestionInput = {
  restaurantId: string
  orderId: string | null
  seat: number | null
  dishId: string
  category?: string | null
  tag?: string | null
  stage?: string | null
  technique?: string | null
  source?: string | null
  guest?: { gender?: string | null; age?: string | null; occasion?: string | null; partySize?: number | null; preferences?: string | null }
  outcome: SuggestionOutcome
}

// Логируем исход ИИ-подсказки (принял «В корзину» / отклонил «Другой вариант»)
// вместе с контекстом и приёмом продаж — это фундамент самообучающейся модели
// (Фаза A: сбор данных). Fire-and-forget: аналитика НЕ должна влиять на UI,
// поэтому любые ошибки глотаем. Пишем через SECURITY DEFINER RPC.
export async function logSuggestionOutcome(i: LogSuggestionInput): Promise<void> {
  try {
    const g = i.guest || {}
    await supabaseWaiter.rpc('log_ai_suggestion_event', {
      p_restaurant_id: i.restaurantId || null,
      p_waiter_id: getWaiterId() || null,
      p_order_id: i.orderId || null,
      p_seat: i.seat ?? null,
      p_dish_id: i.dishId,
      p_category: i.category ?? null,
      p_tag: i.tag ?? null,
      p_stage: i.stage ?? null,
      p_technique: i.technique ?? null,
      p_source: i.source ?? null,
      p_guest: {
        gender: g.gender ?? '',
        age: g.age ?? '',
        occasion: g.occasion ?? '',
        partySize: g.partySize != null ? g.partySize : '',
        hasPreferences: !!g.preferences,
      },
      p_outcome: i.outcome,
    })
  } catch {
    // молча — это аналитика, не критичный путь
  }
}
