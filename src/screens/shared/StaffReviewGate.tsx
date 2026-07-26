import { useState, useEffect, useRef, useCallback } from 'react'
import { getWaiterId } from '../../lib/supabase'
import { getPendingStaffReview, submitStaffFeedback } from '../../lib/staffFeedback'
import type { PendingStaffReview } from '../../lib/staffFeedback'
import StaffReviewModal from './StaffReviewModal'

// Показывает официанту модалку с оценкой ресторана по завершившейся смене
// (>8ч назад). Проверяет при запуске приложения и при возврате на вкладку.
// «Пропустить» скрывает модалку только на ЭТУ сессию (в БД ничего не пишем),
// поэтому при следующем запуске приложения смена всплывёт снова — как и
// договаривались. «Отправить»/«Отказаться» фиксируются в БД навсегда.
export default function StaffReviewGate() {
  const [pending, setPending] = useState<PendingStaffReview | null>(null)
  const handled = useRef<Set<string>>(new Set())

  const check = useCallback(async () => {
    if (pending) return
    const waiterId = getWaiterId()
    if (!waiterId) return
    const p = await getPendingStaffReview(waiterId)
    if (p && !handled.current.has(p.booking_id)) setPending(p)
  }, [pending])

  useEffect(() => {
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [check])

  if (!pending) return null

  const waiterId = getWaiterId() || ''
  const done = () => { handled.current.add(pending.booking_id); setPending(null) }

  return (
    <StaffReviewModal
      review={pending}
      onSubmit={async (rating, comment) => {
        try {
          await submitStaffFeedback({
            workerId: waiterId, bookingId: pending.booking_id, restaurantId: pending.restaurant_id,
            action: 'submit', rating, comment,
          })
        } catch (e) { console.error('submit_staff_feedback:', e) }
        done()
      }}
      onSkip={done}
      onDecline={async () => {
        try {
          await submitStaffFeedback({
            workerId: waiterId, bookingId: pending.booking_id, restaurantId: pending.restaurant_id,
            action: 'decline',
          })
        } catch (e) { console.error('submit_staff_feedback:', e) }
        done()
      }}
    />
  )
}
