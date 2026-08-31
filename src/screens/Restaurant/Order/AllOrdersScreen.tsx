import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import { loadOrderItems, loadGuestAttributes, getOrderStatus, getGuestPaidStatus, sendToKitchen, requestBill, clearTable, updateTableSessionStatus } from '../../../lib/orders'
import type { LoadedOrderItem, GuestAttrs } from '../../../lib/orders'
import { supabase } from '../../../lib/supabase'
import { getActiveShift } from '../QRScanner/QRScannerScreen'
import { useRestaiHint } from '../../../lib/useRestaiHint'
import { buildTableSignals } from '../../../lib/tableCoach'
import { fetchPendingCalls } from '../../../lib/waiterCalls'
import { polishCoachSignals } from '../../../lib/api'
import { readTableCtx } from '../../../lib/tableContext'
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
  // created_at активного вызова официанта по этому столу (kind='service') — для
  // сигнала коуча «гость зовёт». null, если стол сейчас никого не вызывает.
  const [activeCallAt, setActiveCallAt] = useState<string | null>(null)
  // ИИ-полировка реплик коуча: { signalId: тёплая фраза }. Накладывается поверх
  // детерминированного текста, когда официант разворачивает подсказку.
  const [polished, setPolished] = useState<Record<string, string>>({})
  const lastPolishKeyRef = useRef<string>('')

  // Виджет «Подсказка от RestAI»: ИИ смотрит весь заказ стола и советует
  // оптимальный набор дополнений с обоснованием сочетаний.
  const restaurantId = getActiveShift()?.restaurantId ?? ''
  const { text: hintText, loading: hintLoading } = useRestaiHint(
    restaurantId,
    [...new Set(orderItems.map(i => i.item_id))],
  )

  // «Коуч стола» — детерминированные сигналы официанту (опоздание блюда, готово
  // к подаче, пора десерт/повторить напитки). Пересчитывается по тику таймера,
  // поэтому «дозревает» без перезагрузки. Приоритетнее апселла: сервис-факап
  // гасим раньше, чем что-то допродаём.
  const coachSignals = useMemo(
    () => buildTableSignals({ items: orderItems, sessionStartedAt, orderStatus, activeCallAt }),
    // tick — намеренно в зависимостях: он тикает по таймеру и освежает время.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderItems, sessionStartedAt, orderStatus, activeCallAt, tick],
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
    // Тикаем, пока (а) что-то готовится — для таймеров блюд и сигнала опоздания,
    // либо (б) стол открыт с активной сессией — чтобы «дозревали» сигналы коуча
    // по времени за столом (десерт/повтор напитков) даже когда всё уже подано.
    const hasSentItems = orderItems.some(i => i.status === 'sent' && i.sent_at)
    const tableOpen = !!sessionStartedAt && orderStatus !== 'paid'
    if (!hasSentItems && !tableOpen) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      return
    }
    tickRef.current = setInterval(() => setTick(t => t + 1), 30000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [orderItems, sessionStartedAt, orderStatus])

  // Активный вызов официанта по этому столу — для сигнала коуча «гость зовёт».
  // Тянем при открытии и по тику (fetchPendingCalls отдаёт только status=pending,
  // поэтому как только официант принял вызов — сигнал сам гаснет). age_check
  // обрабатывается отдельным оверлеем возраста, здесь только 'service'.
  useEffect(() => {
    const tid = table?.id
    if (!restaurantId || !tid) return
    let cancelled = false
    fetchPendingCalls(restaurantId)
      .then(calls => {
        if (cancelled) return
        const mine = calls
          .filter(c => c.table_id === tid && c.kind === 'service')
          .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
        setActiveCallAt(mine ? mine.created_at : null)
      })
      .catch(() => { if (!cancelled) setActiveCallAt(null) })
    return () => { cancelled = true }
  }, [restaurantId, table?.id, tick])

  // ИИ-полировка реплик коуча — только когда официант РАЗВЕРНУЛ подсказку (экономно:
  // не жжём вызовы модели на фоне). Запрашиваем один раз на набор сигналов+гостя;
  // реплики без чисел, поэтому набор стабилен и по тику не дёргается. На сбой —
  // остаётся детерминированный текст.
  useEffect(() => {
    if (!aiExpanded) return
    const quoted = coachSignals.filter(s => s.quote)
    if (!quoted.length) return
    // Профиль стола для полировки: объединённые предпочтения гостей + повод/число.
    const prefs = [...new Set(Object.values(guestAttrs).map(a => a.preferences).filter(Boolean))].join('; ')
    const ctx = readTableCtx(table?.id)
    const key = quoted.map(s => s.id).sort().join('|') + '::' + prefs + '::' + (ctx.occasion ?? '')
    if (key === lastPolishKeyRef.current) return
    lastPolishKeyRef.current = key
    let cancelled = false
    polishCoachSignals({
      signals: quoted.map(s => ({ id: s.id, text: s.text, quote: s.quote as string })),
      guest: { preferences: prefs || null, occasion: ctx.occasion, partySize: ctx.partySize },
    }).then(map => { if (!cancelled && map) setPolished(prev => ({ ...prev, ...map })) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiExpanded, coachSignals, guestAttrs, table?.id])

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
              {coachSignals.length > 0 && (
                <span
                  className={`${styles.coachHeadDot} ${coachSignals[0].level === 'red' ? styles.coachRed : coachSignals[0].level === 'yellow' ? styles.coachYellow : styles.coachGreen}`}
                  aria-label="есть подсказки по столу"
                />
              )}
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
            {coachSignals.length > 0 ? (
              <ul className={styles.coachList}>
                {coachSignals.map(s => {
                  // Директива + (если есть) произносимая реплика в «…». ИИ-полировка
                  // подменяет ТОЛЬКО реплику; директиву и числа не трогаем.
                  const quote = s.quote ? (polished[s.id] ?? s.quote) : null
                  const text = quote ? `${s.text} «${quote}»` : s.text
                  return (
                    <li key={s.id} className={styles.coachRow}>
                      <span className={`${styles.coachDot} ${s.level === 'red' ? styles.coachRed : s.level === 'yellow' ? styles.coachYellow : styles.coachGreen}`} aria-hidden="true" />
                      <span className={styles.coachText}>
                        <span className={styles.coachIcon} aria-hidden="true">{s.icon} </span>
                        <AiHintText text={text} />
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className={styles.aiText}>
                {hintLoading
                  ? 'Секунду, подбираю рекомендацию…'
                  : (hintText
                      ? <AiHintText text={hintText} />
                      : 'Уточните у гостей, всё ли в порядке с заказом.')}
              </p>
            )}
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
