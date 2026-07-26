import { supabaseWaiter } from './supabase'

export interface PendingStaffReview {
  booking_id: string
  restaurant_id: string
  restaurant_name: string | null
  shift_date: string // 'YYYY-MM-DD'
}

// Самая ранняя смена, за которую пора предложить оценить ресторан
// (подтверждённая, завершилась >8ч назад, ещё не отвечена/не отклонена).
export async function getPendingStaffReview(workerId: string): Promise<PendingStaffReview | null> {
  const { data, error } = await supabaseWaiter.rpc('get_pending_staff_review', { p_worker_id: workerId })
  if (error) {
    console.error('get_pending_staff_review:', error)
    return null
  }
  const row = Array.isArray(data) ? data[0] : data
  return (row as PendingStaffReview) ?? null
}

// action: 'submit' — пишем оценку/коммент; 'decline' — по этой смене больше
// не спрашивать. «Пропустить» сервер не дёргает вовсе (см. StaffReviewGate).
export async function submitStaffFeedback(params: {
  workerId: string
  bookingId: string
  restaurantId: string
  action: 'submit' | 'decline'
  rating?: number
  comment?: string
}): Promise<void> {
  const { error } = await supabaseWaiter.rpc('submit_staff_feedback', {
    p_worker_id: params.workerId,
    p_booking_id: params.bookingId,
    p_restaurant_id: params.restaurantId,
    p_rating: params.rating ?? null,
    p_comment: params.comment ?? null,
    p_action: params.action,
  })
  if (error) throw error
}
