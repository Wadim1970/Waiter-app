import { useState, useEffect, useRef, useCallback } from 'react'
import { getActiveShift } from '../Restaurant/QRScanner/QRScannerScreen'
import { resolveWaiterId } from '../../lib/supabase'
import { subscribeToWaiterCalls, acknowledgeWaiterCall, isCallForMe, type WaiterCall } from '../../lib/waiterCalls'
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

// Вызывается один раз при монтировании — вешает разовые слушатели на первое
// касание/клик где угодно в приложении, задолго до первого реального вызова.
function unlockAudioOnFirstGesture() {
  document.addEventListener('touchend', unlockAudio, { once: true, passive: true })
  document.addEventListener('click', unlockAudio, { once: true })
}

function playCallSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {})
  }
  try {
    const beep = (startTime: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.35, startTime)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(startTime)
      osc.stop(startTime + 0.35)
    }
    const now = ctx.currentTime
    beep(now)
    beep(now + 0.45)
    beep(now + 0.9)
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
          Иду
        </button>
      </div>
    </div>
  )
}
