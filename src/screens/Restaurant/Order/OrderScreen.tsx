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

type GuestCarts = CartItem[][]

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

function getElapsedSeconds(startedAt: string | null): number {
  if (!startedAt) return 0
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
}

export default function OrderScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  const guests = (location.state?.guests ?? []) as GuestData[]
  const guestCarts = (location.state?.guestCarts ?? Array.from({ length: 8 }, (): CartItem[] => [])) as GuestCarts
  const dishes = (location.state?.dishes ?? []) as MenuItem[]
  const initialGuest = (location.state?.activeGuestIndex ?? 0) as number

  const [activeGuest, setActiveGuest] = useState<number>(initialGuest)
  const touchStartX = useRef(0)

  const guestColor = GUEST_COLORS[activeGuest] ?? '#02a826'
  const guestDesc = guests[activeGuest] ? formatGuestDesc(guests[activeGuest]) : ''
  const elapsed = getElapsedSeconds(table?.startedAt ?? null)

  const dishMap: Record<string, MenuItem> = {}
  dishes.forEach(d => { dishMap[d.id] = d })

  // Total price across ALL guests
  const totalPrice = guestCarts.flat().reduce((sum, item) => {
    const dish = dishMap[item.itemId]
    return sum + (dish ? dish.cost_rub * item.quantity : 0)
  }, 0)

  // Cart for current guest only
  const currentCart = guestCarts[activeGuest] ?? []

  const tableNumber = table?.number ?? '—'

  const goToMenu = () => {
    navigate('/restaurant/menu', {
      state: { table, guests, guestCarts, dishes, activeGuestIndex: activeGuest }
    })
  }

  const goToGuestDescription = (guestIndex: number) => {
    navigate('/restaurant/table/' + (table?.id ?? '') + '/guests', {
      state: { table, guests, guestCarts, activeGuestIndex: guestIndex }
    })
  }

  const handleSwipeEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx < -80) goToMenu()
  }

  return (
    <div
      className={styles.screen}
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
      onTouchEnd={handleSwipeEnd}
    >
      {/* ── Fixed header zone (154px): header + guest bar ── */}
      <div className={styles.headerZone}>

        {/* Header 83px */}
        <div className={styles.header}>
          <span className={styles.tableDecor}>СТОЛ №{tableNumber}</span>
          <button className={styles.backBtn} onClick={() => navigate('/restaurant/tables')}>
            <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
              <path d="M21 8H1M1 8L8 1M1 8L8 15" stroke="#717f98" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div className={styles.headerRight}>
            <div className={styles.headerTime}>
              <span className={styles.headerTimeVal}>{formatTime(elapsed)}</span>
              <span className={styles.headerTimeLabel}>за столом</span>
            </div>
            <span className={styles.headerPrice}>{totalPrice} руб</span>
          </div>
        </div>

        {/* Guest bar 70px */}
        <div className={styles.guestBar}>
          {/* "All" circle — just visual, no action on order screen */}
          <button className={styles.guestCircle} onClick={() => {}}>
            <img src="/icons/All.png" className={styles.allIcon} alt="все" />
          </button>

          {GUEST_COLORS.map((color, i) => {
            const isActive = activeGuest === i
            const hasCart = (guestCarts[i]?.length ?? 0) > 0
            return (
              <button
                key={i}
                className={`${styles.guestCircle} ${isActive ? styles.guestCircleActive : ''}`}
                style={isActive ? { borderColor: color } : undefined}
                onClick={() => {
                  if (hasCart) {
                    setActiveGuest(i)
                  } else {
                    goToGuestDescription(i)
                  }
                }}
              >
                <span
                  className={styles.guestLabel}
                  style={{ color: isActive ? color : '#8e9096' }}
                >
                  <span className={styles.guestLabelG}>г</span>
                  <span className={styles.guestLabelN}>{i + 1}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Guest description strip ── */}
      {guestDesc && (
        <div className={styles.guestDesc} style={{ borderLeftColor: guestColor }}>
          <span className={styles.guestDescText} style={{ color: guestColor }}>{guestDesc}</span>
        </div>
      )}

      {/* ── Scrollable content ── */}
      <div className={`${styles.content} ${!guestDesc ? styles.contentNoDesc : ''}`}>
        {currentCart.length === 0 && (
          <p className={styles.empty}>Блюда не выбраны</p>
        )}
        {currentCart.map((item, idx) => {
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

      {/* ── Right-edge МЕНЮ tab ── */}
      <div className={styles.menuTab} onClick={goToMenu}>
        <span className={styles.menuTabText}>МЕНЮ</span>
      </div>

      {/* ── Footer: В МЕНЮ button ── */}
      <div className={styles.footer}>
        <button className={styles.menuBtn} onClick={goToMenu}>В МЕНЮ</button>
      </div>
    </div>
  )
}
