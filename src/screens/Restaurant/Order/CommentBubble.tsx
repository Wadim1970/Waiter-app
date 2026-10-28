import { useState } from 'react'
import type { OrderComment } from '../../../lib/orderComments'
import { guestColor } from '../../../lib/guestColors'
import { authorLabel, formatCommentTime, isUnread } from '../../../lib/commentView'
import styles from './CommentBubble.module.css'

interface BubbleProps {
  comment: OrderComment
  onToggleAck: (comment: OrderComment) => void
}

// Один комментарий. Цвет — цвет гостя (места); у комментария без места — серый.
// Новый (гостя, ещё не «учтён») — на тонированном фоне с пометкой; учтённый тускнеет.
export function CommentBubble({ comment, onToggleAck }: BubbleProps) {
  const color = guestColor(comment.seat_number)
  const unread = isUnread(comment)
  const acked = comment.author === 'guest' && Boolean(comment.acknowledged_at)
  return (
    <div
      id={`comment-${comment.id}`}
      className={`${styles.bubble} ${unread ? styles.unread : ''} ${acked ? styles.acked : ''}`}
      style={{ borderLeftColor: color, background: unread ? `${color}1f` : undefined }}
      onClick={e => e.stopPropagation()}
    >
      <div className={styles.meta}>
        <span className={styles.author} style={{ color }}>
          <span aria-hidden="true">💬 </span>{authorLabel(comment)}
        </span>
        <span className={styles.time}>{formatCommentTime(comment.created_at)}</span>
        {unread && <span className={styles.newBadge}>НОВЫЙ</span>}
      </div>
      <p className={styles.text}>{comment.body}</p>
      {comment.author === 'guest' && (
        <button
          type="button"
          className={`${styles.ackBtn} ${acked ? styles.ackDone : ''}`}
          onClick={() => onToggleAck(comment)}
        >
          {acked ? '✓ учтено' : 'Учтено'}
        </button>
      )}
    </div>
  )
}

interface ComposerProps {
  label: string
  placeholder: string
  onSubmit: (text: string) => Promise<void>
}

// Поле ввода комментария официанта: свёрнуто в кнопку, по нажатию раскрывается.
export function CommentComposer({ label, placeholder, onSubmit }: ComposerProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const send = async () => {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(body)
      setText('')
      setOpen(false)
    } catch {
      setError('Не удалось сохранить комментарий')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.composerOpen} onClick={e => { e.stopPropagation(); setOpen(true) }}>
        ＋ {label}
      </button>
    )
  }

  return (
    <div className={styles.composer} onClick={e => e.stopPropagation()}>
      <textarea
        className={styles.composerText}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={500}
        rows={3}
        autoFocus
      />
      {error && <p className={styles.composerError} role="alert">{error}</p>}
      <div className={styles.composerButtons}>
        <button type="button" className={styles.composerCancel} onClick={() => { setOpen(false); setText(''); setError('') }}>Отмена</button>
        <button type="button" className={styles.composerSend} disabled={busy || !text.trim()} onClick={send}>
          {busy ? '…' : 'Сохранить'}
        </button>
      </div>
    </div>
  )
}
