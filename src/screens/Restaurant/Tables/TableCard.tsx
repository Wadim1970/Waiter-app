import { STATUS_LABELS, STATUS_COLORS, ZONE_LABELS, formatElapsedTime } from '../../../lib/tables'
import type { TableWithSession } from '../../../lib/tables'
import styles from './TableCard.module.css'

interface Props {
  table: TableWithSession
  onClick: (table: TableWithSession) => void
}

export default function TableCard({ table, onClick }: Props) {
  const colors = STATUS_COLORS[table.status]
  const guestLabel = table.guestCount === 0
    ? '0 гостей'
    : table.guestCount === 1
    ? '1 гость'
    : table.guestCount < 5
    ? `${table.guestCount} гостя`
    : `${table.guestCount} гостей`

  return (
    <div
      className={styles.card}
      style={{ background: colors.bg, borderColor: colors.border }}
      onClick={() => onClick(table)}
    >
      <span className={styles.number}>{table.number}</span>
      <div className={styles.topRight}>
        <span className={styles.info}>{guestLabel}</span>
        <span className={styles.info}>{formatElapsedTime(table.startedAt)}</span>
      </div>
      <div className={styles.bottomLeft}>
        <span className={styles.zone}>{ZONE_LABELS[table.zone]}</span>
        <span className={styles.status}>{STATUS_LABELS[table.status]}</span>
      </div>
    </div>
  )
}
