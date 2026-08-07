import { useState, useEffect, useRef, useCallback } from 'react'
import { getActiveShift } from '../Restaurant/QRScanner/QRScannerScreen'
import { resolveWaiterId } from '../../lib/supabase'
import { subscribeToWaiterCalls, acknowledgeWaiterCall, fetchPendingCalls, isCallForMe, type WaiterCall } from '../../lib/waiterCalls'
import styles from './WaiterCallOverlay.module.css'

function BellIcon() {
  return (
    <svg className={styles.bellIcon} width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3a5 5 0 0 0-5 5v3.2c0 .6-.2 1.2-.6 1.7L5 15h14l-1.4-2.1c-.4-.5-.6-1.1-.6-1.7V8a5 5 0 0 0-5-5Z"
        stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"
      />
      <path d="M9.5 18a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

// Простой сгенерированный сигнал через Web Audio — без внешнего аудиофайла.
// Если нужен конкретный звук (mp3) — можно заменить на new Audio(url).play().
//
// iOS Safari создаёт AudioContext сразу в состоянии 'suspended' и запускает
// его ТОЛЬКО изнутри настоящего касания экрана — без ошибки, просто тишина,
// если контекст создать/использовать из асинхронного колбэка (как раз наш
// случай: звук должен играть по событию Realtime, а не по клику). Поэтому
// используем ОДИН общий контекст на всё приложение и один раз "будим" его
// первым же касанием где угодно — дальше его можно дёргать программно.
let sharedAudioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!sharedAudioContext) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
      sharedAudioContext = new AudioCtx()
    }
    return sharedAudioContext
  } catch {
    return null
  }
}

function unlockAudio() {
  const ctx = getAudioContext()
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
}

// Вызывается один раз при монтировании — но слушатели НЕ одноразовые:
// iOS может повторно "усыпить" AudioContext (например, после сворачивания
// приложения), и тогда нужно разблокировать его заново на следующее же
// касание, а не только один раз при самом первом запуске.
function unlockAudioOnFirstGesture() {
  document.addEventListener('touchend', unlockAudio, { passive: true })
  document.addEventListener('click', unlockAudio)
}

function playCallSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  try {
    // Треугольная волна вместо чистой синусоиды — заметнее на телефонных
    // динамиках при том же уровне громкости (больше обертонов).
    const beep = (startTime: number, freq: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, startTime)
      gain.gain.exponentialRampToValueAtTime(0.85, startTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(startTime)
      osc.stop(startTime + duration)
    }
    // "Дзынь-дзынь" — чередование двух тонов, как классический телефонный
    // звонок, вместо одного повторяющегося бипа — узнаваемее и заметнее.
    const ring = (t: number) => {
      beep(t, 1200, 0.15)
      beep(t + 0.15, 900, 0.15)
    }
    const now = ctx.currentTime
    ring(now)
    ring(now + 0.4)
    ring(now + 0.8)
  } catch {
    // Контекст мог оказаться в неожиданном состоянии — не критично
  }
}

// Вибро — только Android (iOS Safari/PWA Vibration API не поддерживает вообще,
// вызов просто тихо не сработает, это ограничение платформы, не баг).
function vibrateCall() {
  if ('vibrate' in navigator) {
    navigator.vibrate([400, 200, 400, 200, 400])
  }
}

export default function WaiterCallOverlay() {
  const [restaurantId, setRestaurantId] = useState<string | null>(null)
  const [waiterId, setWaiterId] = useState<string | null>(null)
  const [queue, setQueue] = useState<WaiterCall[]>([])
  const alertIntervalRef = useRef<number | null>(null)

  // Официант мог сменить ресторан (новый скан QR) — перечитываем смену
  // периодически, это просто чтение localStorage, недорого.
  useEffect(() => {
    const check = () => {
      const shift = getActiveShift()
      setRestaurantId(prev => {
        const next = shift?.restaurantId ?? null
        return next !== prev ? next : prev
      })
    }
    check()
    const interval = setInterval(check, 5000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    resolveWaiterId().then(setWaiterId)
  }, [])

  // Разблокировка звука на iOS — вешаем слушатели один раз при монтировании,
  // задолго до первого реального вызова (см. комментарий у playCallSound).
  useEffect(() => {
    unlockAudioOnFirstGesture()
  }, [])

  const handleNewCall = useCallback((call: WaiterCall) => {
    if (!waiterId || call.status !== 'pending' || !isCallForMe(call, waiterId)) return
    setQueue(prev => (prev.some(c => c.id === call.id) ? prev : [...prev, call]))
  }, [waiterId])

  const handleCallResolved = useCallback((call: WaiterCall) => {
    setQueue(prev => prev.filter(c => c.id !== call.id))
  }, [])

  // Подхватывает вызовы, пропущенные, пока приложение было в фоне —
  // Realtime не отдаёт задним числом события, случившиеся при разорванном
  // соединении, поэтому это отдельный, обычный запрос.
  const refreshPendingCalls = useCallback(async () => {
    if (!restaurantId || !waiterId) return
    try {
      const calls = await fetchPendingCalls(restaurantId)
      const mine = calls.filter(c => isCallForMe(c, waiterId))
      setQueue(prev => {
        const existingIds = new Set(prev.map(c => c.id))
        const toAdd = mine.filter(c => !existingIds.has(c.id))
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev
      })
    } catch (err) {
      console.error('Не удалось получить список вызовов:', err)
    }
  }, [restaurantId, waiterId])

  // При первом появлении смены/официанта — сразу подтягиваем то, что уже
  // могло накопиться (вызов пришёл до открытия приложения).
  //
  // ВАЖНО (холодный старт по пуш-уведомлению): приложение открывается «с нуля»,
  // и сессия supabaseWaiter / контекст смены восстанавливаются не мгновенно.
  // Первый запрос тогда возвращает пусто, а повтор по visibilitychange не
  // случится — вкладка сразу видима, события смены видимости нет. Из-за этого
  // официант открывал приложение по уведомлению и не видел активный вызов.
  // Поэтому делаем несколько повторов в первые секунды: как только сессия
  // готова — вызов всплывёт.
  useEffect(() => {
    refreshPendingCalls()
    const timers = [1000, 2500, 5000, 9000].map(ms => window.setTimeout(refreshPendingCalls, ms))
    return () => timers.forEach(t => clearTimeout(t))
  }, [refreshPendingCalls])

  // Главный фикс: официант свернул приложение (не закрыл — просто ушёл в
  // другое), Realtime-соединение вкладки браузер мог оборвать. При
  // возврате в приложение — сразу перепроверяем, а не ждём следующего
  // случайного события.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshPendingCalls()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [refreshPendingCalls])

  useEffect(() => {
    if (!restaurantId || !waiterId) return
    return subscribeToWaiterCalls(restaurantId, handleNewCall, handleCallResolved)
  }, [restaurantId, waiterId, handleNewCall, handleCallResolved])

  const activeCall = queue[0] ?? null

  // Звук + вибро повторяются, пока вызов открыт — один разовый сигнал легко
  // пропустить, если официант не смотрит в этот момент на телефон.
  useEffect(() => {
    if (!activeCall) return

    playCallSound()
    vibrateCall()
    alertIntervalRef.current = window.setInterval(() => {
      playCallSound()
      vibrateCall()
    }, 4000)

    return () => {
      if (alertIntervalRef.current) {
        clearInterval(alertIntervalRef.current)
        alertIntervalRef.current = null
      }
    }
  }, [activeCall?.id])

  const handleComing = async () => {
    if (!activeCall || !waiterId) return
    unlockAudio() // страховка: настоящее касание, гарантированно разблокирует звук на будущее
    try {
      await acknowledgeWaiterCall(activeCall.id, waiterId)
    } catch (err) {
      console.error('Не удалось отметить отклик на вызов:', err)
    }
    // Из очереди не убираем руками — придёт собственное UPDATE-событие через
    // Realtime и закроет модалку у всех официантов, кому прилетел этот вызов.
  }

  if (!activeCall) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.modalBox}>
        <BellIcon />
        <h2 className={styles.title}>Вызов официанта</h2>
        <p className={styles.tableNumber}>Стол №{activeCall.table_number}</p>
        {queue.length > 1 && (
          <p className={styles.queueHint}>Ещё вызовов в очереди: {queue.length - 1}</p>
        )}
        <button className={styles.comingButton} onClick={handleComing}>
          Уже иду
        </button>
      </div>
    </div>
  )
}
