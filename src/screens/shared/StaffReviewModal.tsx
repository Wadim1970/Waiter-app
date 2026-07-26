import { useState } from 'react'
import type { PendingStaffReview } from '../../lib/staffFeedback'
import styles from './StaffReviewModal.module.css'

const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function formatShiftDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${d} ${MONTHS[m - 1]}`
}

export default function StaffReviewModal({ review, onSubmit, onSkip, onDecline }: {
  review: PendingStaffReview
  onSubmit: (rating: number, comment: string) => void
  onSkip: () => void
  onDecline: () => void
}) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const name = review.restaurant_name || 'ресторане'
  const dateStr = formatShiftDate(review.shift_date)

  const submit = () => {
    if (rating < 1 || busy) return
    setBusy(true)
    onSubmit(rating, comment.trim())
  }
  const guard = (fn: () => void) => () => { if (!busy) { setBusy(true); fn() } }

  return (
    <div className={styles.overlay}>
      <div className={styles.modal}>
        <h2 className={styles.title}>Как прошла смена?</h2>
        <p className={styles.text}>
          {dateStr} вы работали в ресторане <b>«{name}»</b>. Оцените ресторан и, если хотите, оставьте комментарий — это поможет другим официантам.
        </p>

        <div className={styles.stars}>
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              type="button"
              className={styles.starBtn}
              onClick={() => setRating(s)}
              aria-label={`${s} из 5`}
            >
              <span className={s <= rating ? styles.starOn : styles.starOff}>★</span>
            </button>
          ))}
        </div>

        <textarea
          className={styles.comment}
          placeholder="Комментарий (не обязательно)…"
          value={comment}
          onChange={e => setComment(e.target.value)}
        />

        <button
          type="button"
          className={styles.submitBtn}
          onClick={submit}
          disabled={rating < 1 || busy}
        >
          Отправить
        </button>

        <div className={styles.secondaryRow}>
          <button type="button" className={styles.textBtn} onClick={guard(onSkip)} disabled={busy}>
            Пропустить
          </button>
          <button type="button" className={styles.textBtn} onClick={guard(onDecline)} disabled={busy}>
            Отказаться
          </button>
        </div>
      </div>
    </div>
  )
}
