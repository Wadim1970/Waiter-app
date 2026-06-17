import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import { loadOrderItems, loadGuestAttributes, removeOrderItem, markItemReady } from '../../../lib/orders'
import type { LoadedOrderItem, GuestAttrs } from '../../../lib/orders'
import styles from './OrderScreen.module.css'

const GUEST_COLORS = ['#02a826','#ce00b9','#ff9500','#003daf','#6c03ed','#0f929c','#700061','#979200']

type GuestData = GuestAttrs

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
  const orderId = location.state?.orderId as string | undefined
  const initialGuest = (location.state?.activeGuestIndex ?? 0) as number
  const noAnimation = location.state?.noAnimation === true

  const initialItems = (location.state?.orderItems ?? []) as LoadedOrderItem[]
  const initialAttrs = (location.state?.guestAttrs ?? {}) as Record<number, GuestAttrs>

  const [activeGuest, setActiveGuest] = useState<number>(initialGuest)
  const [orderItems, setOrderItems] = useState<LoadedOrderItem[]>(initialItems)
  const [itemsLoaded, setItemsLoaded] = useState(initialItems.length > 0)
  const [guestAttrs, setGuestAttrs] = useState<Record<number, GuestAttrs>>(initialAttrs)
  const touchStartX = useRef(0)

  useEffect(() => {
    if (!orderId) { setItemsLoaded(true); return }
    Promise.all([
      loadOrderItems(orderId),
      loadGuestAttributes(orderId),
    ]).then(([items, attrs]) => {
      setOrderItems(items)
      setGuestAttrs(attrs)
      setItemsLoaded(true)
    })
  }, [orderId])

  const guestColor = GUEST_COLORS[activeGuest] ?? '#02a826'
  const dbAttrs = guestAttrs[activeGuest + 1]
  const navAttrs = guests[activeGuest]
  const guestDesc = dbAttrs ? formatGuestDesc(dbAttrs) : (navAttrs ? formatGuestDesc(navAttrs) : '')
  const elapsed = getElapsedSeconds(table?.startedAt ?? null)

  const currentItems = orderItems.filter(i => i.seat_number === activeGuest + 1)
  const totalPrice = currentItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  const tableNumber = table?.number ?? '—'

  const goToMenu = () => {
    navigate('/restaurant/menu', {
      state: { table, guests, orderId, activeGuestIndex: activeGuest }
    })
  }

  const goToGuestDescription = (guestIndex: number) => {
    const seatsWithItems = [...new Set(orderItems.map(i => i.seat_number))]
    navigate(`/restaurant/table/${table?.id ?? ''}/guests`, {
      state: { table, guests, orderId, activeGuestIndex: guestIndex, seatsWithItems }
    })
  }

  const handleMarkReady = async (item: LoadedOrderItem) => {
    await markItemReady(item.id)
    setOrderItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'ready' } : i))
  }

  const handleRemove = async (item: LoadedOrderItem) => {
    await removeOrderItem(item.id, item.quantity)
    const next = item.quantity > 1
      ? orderItems.map(i => i.id === item.id ? { ...i, quantity: i.quantity - 1 } : i)
      : orderItems.filter(i => i.id !== item.id)
    setOrderItems(next)
    const guestStillHasItems = next.some(i => i.seat_number === activeGuest + 1)
    if (!guestStillHasItems) {
      goToGuestDescription(activeGuest)
    }
  }

  const handleSwipeEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx < -80) goToMenu()
  }

  return (
    <div
      className={`${styles.screen} ${noAnimation ? styles.screenNoAnim : ''}`}
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
      onTouchEnd={handleSwipeEnd}
    >
      {/* ── Fixed header zone ── */}
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
          </div>
          <span className={styles.headerPrice}>{totalPrice} руб</span>
        </div>

        {/* Guest bar 70px */}
        <div className={styles.guestBar}>
          <button
            className={styles.guestCircle}
            onClick={() => navigate(`/restaurant/table/${table?.id ?? ''}/all-orders`, {
              state: { table, guests, orderId, orderItems, guestAttrs }
            })}
          >
            <img src="/icons/All.png" className={styles.allIcon} alt="все" />
          </button>

          {GUEST_COLORS.map((color, i) => {
            const isActive = activeGuest === i
            const hasItems = orderItems.some(item => item.seat_number === i + 1)
            const showBorder = isActive || hasItems
            return (
              <button
                key={i}
                className={`${styles.guestCircle} ${isActive ? styles.guestCircleActive : ''}`}
                style={showBorder ? { borderColor: color } : undefined}
                onClick={() => {
                  if (!itemsLoaded) return
                  if (hasItems) {
                    setActiveGuest(i)
                  } else {
                    goToGuestDescription(i)
                  }
                }}
              >
                <span
                  className={styles.guestLabel}
                  style={{ color: (isActive || hasItems) ? color : '#8e9096' }}
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
        {itemsLoaded && currentItems.length === 0 && (
          <p className={styles.empty}>Блюда не выбраны</p>
        )}
        {currentItems.map(item => {
          const price = item.unit_price * item.quantity
          const isSent = item.status === 'sent' || item.status === 'ready'
          const isReady = item.status === 'ready'

          if (isSent) {
            return (
              <div key={item.id} className={styles.dishCardSent}>
                <div className={styles.dishCardTop}>
                  <span className={styles.dishCardName}>{item.dish_name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
                  <span className={styles.dishCardPrice}>{price} руб</span>
                </div>
                {item.modifiers.length > 0 && (
                  <div className={styles.dishCardMods}>
                    {item.modifiers.map((m, mi) => (
                      <span key={mi} className={styles.dishCardMod}>
                        {m.groupName ? `${m.groupName}: ${m.name}` : m.name}
                      </span>
                    ))}
                  </div>
                )}
                {item.comment && (
                  <p className={styles.dishCardComment}>{item.comment}</p>
                )}
                <div className={styles.dishCardBottom}>
                  <span className={styles.dishCardTime}>{item.cook_time_min} мин</span>
                  {!isReady && (
                    <button className={styles.readyBtn} onClick={() => handleMarkReady(item)}>
                      ГОТОВО
                    </button>
                  )}
                  {isReady && (
                    <span className={styles.readyDone}>✓ подано</span>
                  )}
                </div>
              </div>
            )
          }

          return (
            <div key={item.id} className={styles.dishCard} style={{ borderColor: guestColor, borderLeftColor: guestColor }}>
              <div className={styles.dishCardTop}>
                <span className={styles.dishCardName}>{item.dish_name}</span>
                <span className={styles.dishCardPrice}>{price} руб</span>
              </div>
              {item.modifiers.length > 0 && (
                <div className={styles.dishCardMods}>
                  {item.modifiers.map((m, mi) => (
                    <span key={mi} className={styles.dishCardMod}>
                      {m.groupName ? `${m.groupName}: ${m.name}` : m.name}
                    </span>
                  ))}
                </div>
              )}
              {item.comment && (
                <p className={styles.dishCardComment}>{item.comment}</p>
              )}
              <div className={styles.dishCardBottom}>
                <span className={styles.dishCardTime}>{item.cook_time_min} мин</span>
                <div className={styles.dishCardControls}>
                  <button className={styles.minusBtn} onClick={() => handleRemove(item)}>−</button>
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
