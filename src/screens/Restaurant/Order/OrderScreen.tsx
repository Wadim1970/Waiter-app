import { useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import styles from './OrderScreen.module.css'

const GUEST_COLORS = ['#02a826','#ce00b9','#ff9500','#003daf','#6c03ed','#0f929c','#700061','#979200']

type GuestData = { gender: string | null; age: string | null; body: string | null; hair: string | null }

type CartItem = {
  itemId: string
  quantity: number
  selectedModifiers: Record<string, string>
  resolvedModifiers: { groupName: string; modName: string }[]
}

type MenuItem = {
  id: string
  dish_name: string
  cost_rub: number
  cook_time_min: number
  weight_g: number
  section_id: string
}

function formatGuestDesc(g: GuestData): string {
  const parts = [
    g.gender ? g.gender + '.' : null,
    g.age ?? null,
    g.body ? g.body.toLowerCase() : null,
    g.hair ? g.hair.toLowerCase() : null,
  ].filter(Boolean)
  return parts.join(', ')
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  return `${m} мин`
}

function getElapsedSeconds(session: TableWithSession['active_session']): number {
  if (!session?.created_at) return 0
  return Math.floor((Date.now() - new Date(session.created_at).getTime()) / 1000)
}

export default function OrderScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  const guests = (location.state?.guests ?? []) as GuestData[]
  const cart = (location.state?.cart ?? []) as CartItem[]
  const dishes = (location.state?.dishes ?? []) as MenuItem[]
  const initialGuest = (location.state?.activeGuestIndex ?? 0) as number

  const [activeGuest, setActiveGuest] = useState<number>(initialGuest)
  const touchStartX = useRef(0)

  const guestColor = GUEST_COLORS[activeGuest] ?? '#02a826'
  const guestDesc = guests[activeGuest] ? formatGuestDesc(guests[activeGuest]) : ''
  const elapsed = getElapsedSeconds(table?.active_session)

  const dishMap: Record<string, MenuItem> = {}
  dishes.forEach(d => { dishMap[d.id] = d })

  const totalPrice = cart.reduce((sum, item) => {
    const dish = dishMap[item.itemId]
    return sum + (dish ? dish.cost_rub * item.quantity : 0)
  }, 0)

  const handleSwipeEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx < -80) {
      navigate('/restaurant/menu', {
        state: { table, guests, cart, activeGuestIndex: activeGuest }
      })
    }
  }

  const tableNumber = table?.table_number ?? '—'

  return (
    <div
      className={styles.screen}
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
      onTouchEnd={handleSwipeEnd}
    >
      {/* ── Header ── */}
      <div className={styles.header}>
        <span className={styles.tableDecor}>СТОЛ №{tableNumber}</span>
        <button className={styles.backBtn} onClick={() => navigate('/restaurant/tables')}>
          <svg width="22" height="20" viewBox="0 0 22 20" fill="none">
            <rect x="3" y="8.5" width="18" height="3" rx="1.5" fill="#717F98"/>
            <rect x="0" y="6.36" width="9" height="3" rx="1.5" transform="rotate(-45 0 6.36)" fill="#717F98"/>
            <rect x="5.66" y="8" width="9" height="3" rx="1.5" transform="rotate(45 5.66 8)" fill="#717F98"/>
          </svg>
        </button>
        <div className={styles.headerPrice}>{totalPrice} руб</div>
        <div className={styles.headerTime}>
          <span className={styles.headerTimeVal}>{formatTime(elapsed)}</span>
          <span className={styles.headerTimeLabel}>за столом</span>
        </div>
      </div>

      {/* ── Guest circles ── */}
      <div className={styles.guestBar}>
        <button className={styles.guestCircle} onClick={() => {}}>
          <img src="/icons/All.png" className={styles.allIcon} alt="все" />
        </button>
        {Array.from({ length: 8 }, (_, i) => {
          const color = GUEST_COLORS[i]
          const isActive = activeGuest === i
          return (
            <button
              key={i}
              className={`${styles.guestCircle} ${isActive ? styles.guestCircleActive : ''}`}
              style={isActive ? { borderColor: color } : {}}
              onClick={() => setActiveGuest(i)}
            >
              <span className={styles.guestLabel}>
                <span className={styles.guestLabelG} style={isActive ? { color } : {}}>г</span>
                <span className={styles.guestLabelN} style={isActive ? { color } : {}}>{i + 1}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* ── White divider ── */}
      <div className={styles.divider} />

      {/* ── Guest description ── */}
      {guestDesc && (
        <div className={styles.guestDesc} style={{ borderColor: guestColor, borderLeftColor: guestColor }}>
          <span className={styles.guestDescText} style={{ color: guestColor }}>{guestDesc}</span>
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div className={`${styles.content} ${!guestDesc ? styles.contentNoDesc : ''}`}>
        {cart.length === 0 && (
          <p className={styles.empty}>Блюда не выбраны</p>
        )}
        {cart.map((item, idx) => {
          const dish = dishMap[item.itemId]
          if (!dish) return null
          const price = dish.cost_rub * item.quantity
          const hasMods = item.resolvedModifiers.length > 0
          return (
            <div key={idx} className={styles.dishCard} style={{ borderColor: guestColor, borderLeftColor: guestColor }}>
              <div className={styles.dishCardTop}>
                <span className={styles.dishCardName}>{dish.dish_name}</span>
                <span className={styles.dishCardPrice}>{price} руб</span>
              </div>
              {hasMods && (
                <div className={styles.dishCardMods}>
                  {item.resolvedModifiers.map((m, mi) => (
                    <span key={mi} className={styles.dishCardMod}>{m.groupName}: {m.modName}</span>
                  ))}
                </div>
              )}
              <div className={styles.dishCardBottom}>
                <span className={styles.dishCardTime}>{dish.cook_time_min} мин</span>
                <div className={styles.dishCardControls}>
                  <button className={styles.minusBtn}>−</button>
                  <span className={styles.qty}>{item.quantity}</span>
                  <button className={styles.addBtn}>+</button>
                </div>
              </div>
            </div>
          )
        })}

        {/* ── AI hint block ── */}
        <div className={styles.aiBlock}>
          <div className={styles.aiHeader}>
            <span className={styles.aiTitle}>Подсказка от <strong>RestAI</strong></span>
            <span className={styles.aiIcon}>✦</span>
          </div>
          <div className={styles.aiBody}>
            <p className={styles.aiText}>
              Гости заказали сытные блюда — предложите лёгкий десерт или дижестив. Уточните у гостей, всё ли в порядке с заказом.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
