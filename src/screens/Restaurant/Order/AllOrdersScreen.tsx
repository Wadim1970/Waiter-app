import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import { loadOrderItems, loadGuestAttributes, getOrderStatus, sendToKitchen, requestBill, clearTable } from '../../../lib/orders'
import type { LoadedOrderItem, GuestAttrs } from '../../../lib/orders'
import styles from './AllOrdersScreen.module.css'

const GUEST_COLORS = ['#02a826','#ce00b9','#ff9500','#003daf','#6c03ed','#0f929c','#700061','#979200']

type GuestData = GuestAttrs

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

export default function AllOrdersScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  const guests = (location.state?.guests ?? []) as GuestData[]
  const orderId = location.state?.orderId as string | undefined

  const initialItems = (location.state?.orderItems ?? []) as LoadedOrderItem[]
  const initialAttrs = (location.state?.guestAttrs ?? {}) as Record<number, GuestAttrs>

  const [orderItems, setOrderItems] = useState<LoadedOrderItem[]>(initialItems)
  const [guestAttrs, setGuestAttrs] = useState<Record<number, GuestAttrs>>(initialAttrs)
  const [itemsLoaded, setItemsLoaded] = useState(initialItems.length > 0)
  const [orderStatus, setOrderStatus] = useState<string>('new')
  const [btnLoading, setBtnLoading] = useState(false)
  const [aiExpanded, setAiExpanded] = useState(false)

  useEffect(() => {
    if (!orderId) { setItemsLoaded(true); return }
    Promise.all([
      loadOrderItems(orderId),
      loadGuestAttributes(orderId),
      getOrderStatus(orderId),
    ]).then(([items, attrs, status]) => {
      setOrderItems(items)
      setGuestAttrs(attrs)
      setOrderStatus(status ?? 'new')
      setItemsLoaded(true)
    })
  }, [orderId])

  const hasNewItems = orderItems.some(i => i.status === 'new')

  const btnLabel = hasNewItems
    ? 'ОТПРАВИТЬ НА КУХНЮ'
    : orderStatus === 'bill_requested'
      ? 'ОЧИСТИТЬ СТОЛ'
      : orderStatus === 'paid'
        ? ''
        : 'СЧЕТ'

  const handleMainBtn = async () => {
    if (!orderId || btnLoading) return
    setBtnLoading(true)
    try {
      if (hasNewItems) {
        await sendToKitchen(orderId)
        setOrderItems(prev => prev.map(i => i.status === 'new' ? { ...i, status: 'sent' } : i))
        setOrderStatus('cooking')
      } else if (orderStatus === 'cooking' || orderStatus === 'new') {
        await requestBill(orderId)
        setOrderStatus('bill_requested')
      } else if (orderStatus === 'bill_requested') {
        await clearTable(orderId)
        setOrderStatus('paid')
        navigate('/restaurant/tables')
      }
    } finally {
      setBtnLoading(false)
    }
  }

  const elapsed = getElapsedSeconds(table?.startedAt ?? null)
  const totalPrice = orderItems.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)
  const tableNumber = table?.number ?? '—'

  const seatsWithItems = [...new Set(orderItems.map(i => i.seat_number))].sort()

  const goToGuest = (guestIndex: number) => {
    const hasItems = seatsWithItems.includes(guestIndex + 1)
    if (hasItems) {
      navigate(`/restaurant/table/${table?.id ?? ''}/order`, {
        state: { table, guests, orderId, orderItems, guestAttrs, activeGuestIndex: guestIndex, noAnimation: true }
      })
    } else {
      navigate(`/restaurant/table/${table?.id ?? ''}/guests`, {
        state: { table, guests, orderId, activeGuestIndex: guestIndex, seatsWithItems }
      })
    }
  }

  return (
    <div className={styles.screen}>

      {/* ── Header 83px ── */}
      <div className={styles.header}>
        <span className={styles.tableDecor}>СТОЛ №{tableNumber}</span>
        <button className={styles.backBtn} onClick={() => navigate('/restaurant/tables')}>
          <svg width="22" height="16" viewBox="0 0 22 16" fill="none">
            <path d="M21 8H1M1 8L8 1M1 8L8 15" stroke="#717f98" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <span className={styles.headerPrice}>{totalPrice} руб</span>
        <div className={styles.headerRight}>
          <div className={styles.headerTime}>
            <span className={styles.headerTimeVal}>{formatTime(elapsed)}</span>
            <span className={styles.headerTimeLabel}>за столом</span>
          </div>
        </div>
      </div>

      {/* ── Guest bar ── */}
      <div className={styles.guestBar}>
        <button className={`${styles.guestCircle} ${styles.guestCircleAllActive}`}>
          <img src="/icons/All.png" className={styles.allIcon} alt="все" />
        </button>

        {GUEST_COLORS.map((color, i) => {
          const hasItems = seatsWithItems.includes(i + 1)
          return (
            <button
              key={i}
              className={styles.guestCircle}
              style={{ borderColor: hasItems ? color : '#8e9096' }}
              onClick={() => goToGuest(i)}
            >
              <span className={styles.guestLabel} style={{ color: hasItems ? color : '#8e9096' }}>
                <span className={styles.guestLabelG}>г</span>
                <span className={styles.guestLabelN}>{i + 1}</span>
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Scrollable content ── */}
      <div className={styles.content}>
        {itemsLoaded && seatsWithItems.length === 0 && (
          <p className={styles.empty}>Нет блюд</p>
        )}

        {seatsWithItems.map(seat => {
          const color = GUEST_COLORS[seat - 1] ?? '#02a826'
          const items = orderItems.filter(i => i.seat_number === seat)
          const guestTotal = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)

          return (
            <div
              key={seat}
              className={styles.guestCard}
              style={{ borderColor: color, borderLeftColor: color }}
              onClick={() => goToGuest(seat - 1)}
            >
              {items.map(item => (
                <div key={item.id} className={styles.dishRow}>
                  <div className={styles.dishRowMain}>
                    <span className={styles.dishName}>
                      {item.dish_name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}
                    </span>
                    <div className={styles.dishStatus}>
                      <span className={styles.statusDotYellow} />
                      <span className={styles.statusTime}>{item.cook_time_min} мин</span>
                    </div>
                  </div>
                  {item.modifiers.map((m, mi) => (
                    <div key={mi} className={styles.modRow}>
                      {m.groupName ? `${m.groupName}: ${m.name}` : m.name}
                    </div>
                  ))}
                  {item.comment && (
                    <div className={styles.commentRow}>{item.comment}</div>
                  )}
                </div>
              ))}
              <div className={styles.guestCardTotal}>{guestTotal} руб</div>
            </div>
          )
        })}
      </div>

      {/* ── Fixed bottom: AI block + button ── */}
      <div className={styles.fixedBottom}>
        <div className={styles.aiBlock}>
          <div className={styles.aiHeader}>
            <span className={styles.aiTitle}>
              Подсказка от <strong>RestAI</strong>
            </span>
            <button className={styles.aiToggleBtn} onClick={() => setAiExpanded(v => !v)}>
              <img
                src={aiExpanded ? '/icons/icon_collapse.png' : '/icons/icon_reveal.png'}
                width={14}
                height={14}
                alt={aiExpanded ? 'свернуть' : 'развернуть'}
              />
            </button>
          </div>
          <div className={`${styles.aiBody} ${aiExpanded ? styles.aiBodyExpanded : ''}`}>
            <p className={styles.aiText}>
              Гости заказали сытные блюда — предложите лёгкий десерт или дижестив. Уточните у гостей, всё ли в порядке с заказом.
            </p>
          </div>
        </div>

        {btnLabel ? (
          <div className={styles.footer}>
            <button
              className={`${styles.sendBtn} ${orderStatus === 'bill_requested' ? styles.sendBtnClear : ''}`}
              onClick={handleMainBtn}
              disabled={btnLoading}
            >
              {btnLoading ? '...' : btnLabel}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
