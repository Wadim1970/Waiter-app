import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import { loadOrderItems, loadGuestAttributes, getOrderStatus, getGuestPaidStatus, sendToKitchen, requestBill, clearTable, updateTableSessionStatus } from '../../../lib/orders'
import type { LoadedOrderItem, GuestAttrs } from '../../../lib/orders'
import { supabase } from '../../../lib/supabase'
import { getActiveShift } from '../QRScanner/QRScannerScreen'
import { useRestaiHint } from '../../../lib/useRestaiHint'
import AiHintText from '../../shared/AiHintText'
import styles from './AllOrdersScreen.module.css'

const GUEST_COLORS = ['#02a826','#ce00b9','#ff9500','#003daf','#6c03ed','#0f929c','#700061','#979200']

type GuestData = GuestAttrs

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  return `${m} мин`
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

function getElapsedSeconds(startedAt: string | null): number {
  if (!startedAt) return 0
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
}

function getTimerState(sentAt: string | null, cookTimeMin: number): {
  dotClass: string
  label: string
} {
  if (!sentAt) return { dotClass: styles.statusDotYellow, label: `${cookTimeMin} мин` }
  const elapsedMin = (Date.now() - new Date(sentAt).getTime()) / 60000
  const remainingMin = cookTimeMin - elapsedMin
  if (remainingMin > 0) {
    return { dotClass: styles.statusDotYellow, label: `${Math.ceil(remainingMin)} мин` }
  }
  if (elapsedMin < cookTimeMin * 1.5) {
    return { dotClass: styles.statusDotGreen, label: 'готово' }
  }
  const overdueMin = Math.floor(elapsedMin - cookTimeMin)
  return { dotClass: styles.statusDotRed, label: `+${overdueMin} мин` }
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
  // Место (seat_number) -> 'paid', если гость оплатил через RestAI сам, без
  // участия официанта (pay_table_seats). Такое место дальше скрываем из
  // списка карточек — официант не должен видеть уже закрытую гостем корзину.
  const [guestPaidStatus, setGuestPaidStatus] = useState<Record<number, string>>({})
  const [itemsLoaded, setItemsLoaded] = useState(initialItems.length > 0)
  const [orderStatus, setOrderStatus] = useState<string>('new')
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(table?.startedAt ?? null)
  const [btnLoading, setBtnLoading] = useState(false)
  const [aiExpanded, setAiExpanded] = useState(false)
  const [tick, setTick] = useState(0)

  // Виджет «Подсказка от RestAI»: ИИ смотрит весь заказ стола и советует
  // оптимальный набор дополнений с обоснованием сочетаний.
  const restaurantId = getActiveShift()?.restaurantId ?? ''
  const { text: hintText, loading: hintLoading } = useRestaiHint(
    restaurantId,
    [...new Set(orderItems.map(i => i.item_id))],
  )
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const refreshOrder = useCallback(async () => {
    if (!orderId) { setItemsLoaded(true); return }
    const [items, attrs, status, paidStatus] = await Promise.all([
      loadOrderItems(orderId),
      loadGuestAttributes(orderId),
      getOrderStatus(orderId),
      getGuestPaidStatus(orderId),
    ])
    setOrderItems(items)
    setGuestAttrs(attrs)
    setOrderStatus(status ?? 'new')
    setGuestPaidStatus(paidStatus)
    setItemsLoaded(true)
  }, [orderId])

  useEffect(() => { refreshOrder() }, [refreshOrder])

  // Realtime по одному заказу. Два независимых источника изменений от гостя
  // через RestAI, пока официант смотрит на этот экран:
  //   1. order_guests — гость оплатил своё место (pay_table_seats): точечно
  //      помечаем место 'paid', его карточка дальше скрывается.
  //   2. order_items — гость докинул блюда в существующий заказ
  //      (place_guest_order, приходят как 'sent'): перечитываем заказ целиком,
  //      чтобы новые позиции, суммы и таймеры появились у официанта сразу.
  useEffect(() => {
    if (!orderId) return

    const filter = `order_id=eq.${orderId}`
    const patchGuest = (payload: any) => {
      const row = payload.new as { seat_number: number; status: string | null }
      setGuestPaidStatus(prev => ({ ...prev, [row.seat_number]: row.status ?? '' }))
    }

    const channel = supabase
      .channel(`order:${orderId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_guests', filter }, patchGuest)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_guests', filter }, patchGuest)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'order_items', filter }, () => { refreshOrder() })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'order_items', filter }, () => { refreshOrder() })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'order_items', filter }, () => { refreshOrder() })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [orderId, refreshOrder])

  useEffect(() => {
    const hasSentItems = orderItems.some(i => i.status === 'sent' && i.sent_at)
    if (!hasSentItems) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      return
    }
    tickRef.current = setInterval(() => setTick(t => t + 1), 30000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [orderItems])

  const hasNewItems = orderItems.some(i => i.status !== 'sent' && i.status !== 'ready')

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
        const now = new Date().toISOString()
        await sendToKitchen(orderId)
        setOrderItems(prev => prev.map(i =>
          i.status !== 'sent' ? { ...i, status: 'sent', sent_at: now } : i
        ))
        setOrderStatus('cooking')
        if (table?.id) {
          await updateTableSessionStatus(table.id, 'preparing', seatsWithItems.length)
          if (!sessionStartedAt) setSessionStartedAt(now)
        }
      } else if (orderStatus === 'cooking' || orderStatus === 'new') {
        await requestBill(orderId)
        setOrderStatus('bill_requested')
        if (table?.id) await updateTableSessionStatus(table.id, 'bill_requested')
      } else if (orderStatus === 'bill_requested') {
        await clearTable(orderId)
        setOrderStatus('paid')
        if (table?.id) await updateTableSessionStatus(table.id, 'free')
        navigate('/restaurant/tables')
      }
    } finally {
      setBtnLoading(false)
    }
  }

  const elapsed = getElapsedSeconds(sessionStartedAt)
  const tableNumber = table?.number ?? '—'

  // seatsWithItems — реальный список мест с позициями, используется там, где
  // важен физический состав стола (например, guest_count при отправке на
  // кухню — гость, оплативший раньше остальных, не перестаёт сидеть за
  // столом). visibleSeats — то же самое, но без уже оплаченных гостем самим
  // мест: их корзины должны пропадать из интерфейса официанта.
  const seatsWithItems = [...new Set(orderItems.map(i => i.seat_number))].sort()
  const visibleSeats = seatsWithItems.filter(seat => guestPaidStatus[seat] !== 'paid')
  const totalPrice = orderItems
    .filter(i => guestPaidStatus[i.seat_number] !== 'paid')
    .reduce((sum, i) => sum + i.unit_price * i.quantity, 0)

  const goToGuest = (guestIndex: number) => {
    const hasItems = visibleSeats.includes(guestIndex + 1)
    if (hasItems) {
      navigate(`/restaurant/table/${table?.id ?? ''}/order`, {
        state: { table, guests, orderId, orderItems, guestAttrs, activeGuestIndex: guestIndex, noAnimation: true }
      })
    } else {
      navigate(`/restaurant/table/${table?.id ?? ''}/guests`, {
        state: { table, guests, orderId, activeGuestIndex: guestIndex, seatsWithItems: visibleSeats }
      })
    }
  }

  void tick

  return (
    <div className={styles.screen}>

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

      <div className={styles.guestBar}>
        <button className={`${styles.guestCircle} ${styles.guestCircleAllActive}`}>
          <img src="/icons/All.png" className={styles.allIcon} alt="все" />
        </button>

        {GUEST_COLORS.map((color, i) => {
          const hasItems = visibleSeats.includes(i + 1)
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

      <div className={styles.content}>
        {itemsLoaded && visibleSeats.length === 0 && (
          <p className={styles.empty}>Нет блюд</p>
        )}

        {visibleSeats.map(seat => {
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
              {(() => {
                const attrs = guestAttrs[seat]
                const desc = attrs ? formatGuestDesc(attrs) : ''
                return desc ? (
                  <div className={styles.guestDesc} style={{ color }}>
                    {desc}
                  </div>
                ) : null
              })()}
              {items.map(item => {
                const isReady = item.status === 'ready'
                const isSent = item.status === 'sent'
                let timer: { dotClass: string; label: string }
                if (isReady) {
                  timer = { dotClass: styles.statusDotGreen, label: getTimerState(item.sent_at, item.cook_time_min).label }
                } else if (isSent) {
                  timer = getTimerState(item.sent_at, item.cook_time_min)
                } else {
                  timer = { dotClass: styles.statusDotGrey, label: `${item.cook_time_min} мин` }
                }

                return (
                  <div key={item.id} className={styles.dishRow}>
                    <div className={styles.dishRowMain}>
                      <span className={styles.dishName}>
                        {item.dish_name}{item.quantity > 1 ? ` x${item.quantity}` : ''}
                      </span>
                      <div className={styles.dishStatus}>
                        <span className={timer.dotClass} />
                        <span className={styles.statusTime}>{timer.label}</span>
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
                )
              })}
              <div className={styles.guestCardTotal}>{guestTotal} руб</div>
            </div>
          )
        })}
      </div>

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
              {hintLoading
                ? 'Секунду, подбираю рекомендацию…'
                : (hintText
                    ? <AiHintText text={hintText} />
                    : 'Уточните у гостей, всё ли в порядке с заказом.')}
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
