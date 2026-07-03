import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, resolveWaiterId } from '../../../lib/supabase'
import { hasConfirmedShiftToday } from '../../../lib/bookings'
import RestaurantAccessDeniedModal from '../../shared/RestaurantAccessDeniedModal'
import styles from './QRScannerScreen.module.css'

const SHIFT_KEY = 'waiter_shift'
const SHIFT_DURATION_MS = 12 * 60 * 60 * 1000 // 12 часов

export function getActiveShift(): { restaurantId: string; scannedAt: number } | null {
  try {
    const raw = localStorage.getItem(SHIFT_KEY)
    if (!raw) return null
    const shift = JSON.parse(raw)
    if (Date.now() - shift.scannedAt > SHIFT_DURATION_MS) {
      localStorage.removeItem(SHIFT_KEY)
      return null
    }
    return shift
  } catch {
    return null
  }
}

export default function QRScannerScreen() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  // Если смена уже активна — сразу на столы
  useEffect(() => {
    const shift = getActiveShift()
    if (shift) {
      navigate(`/restaurant/tables?restaurant=${shift.restaurantId}`, { replace: true })
    }
  }, [])

  useEffect(() => {
    let stopped = false
    let controls: { stop: () => void } | null = null

    const startScanner = async () => {
      try {
        const { BrowserQRCodeReader, BrowserCodeReader } = await import('@zxing/browser')

        const codeReader = new BrowserQRCodeReader()

        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices()
        const backCamera = videoInputDevices.find(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('environment')
        ) ?? videoInputDevices[videoInputDevices.length - 1]

        controls = await codeReader.decodeFromVideoDevice(
          backCamera?.deviceId,
          videoRef.current!,
          async (result) => {
            if (stopped || !result) return
            stopped = true
            controls?.stop()
            await handleScan(result.getText())
          }
        )
      } catch {
        setError('Не удалось запустить камеру. Проверьте разрешения.')
      }
    }

    startScanner()
    return () => { stopped = true; controls?.stop() }
  }, [])

  const handleScan = async (decodedText: string) => {
    setError(null)

    let token = decodedText.trim()
    try {
      const url = new URL(decodedText)
      token = url.searchParams.get('token') ?? decodedText
    } catch {}

    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('restaurant_daily_tokens')
      .select('restaurant_id')
      .eq('token', token)
      .eq('valid_date', today)
      .maybeSingle()

    if (!data) {
      setError('QR-код недействителен или устарел.')
      return
    }

    // QR-код валиден, но одного этого мало — доступ к столам конкретного
    // ресторана даём только при подтверждённой смене там же и сегодня.
    const waiterId = await resolveWaiterId()
    const allowed = waiterId ? await hasConfirmedShiftToday(waiterId, data.restaurant_id) : false
    if (!allowed) {
      setAccessDenied(true)
      return
    }

    // Сохраняем смену на 12 часов
    localStorage.setItem(SHIFT_KEY, JSON.stringify({
      restaurantId: data.restaurant_id,
      scannedAt: Date.now(),
    }))

    navigate(`/restaurant/tables?restaurant=${data.restaurant_id}`)
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>←</button>
        <h1 className={styles.title}>Сканировать QR</h1>
      </div>

      <div className={styles.body}>
        <div className={styles.viewfinder}>
          <video ref={videoRef} className={styles.video} />
          <div className={styles.overlay}>
            <div className={styles.corner} />
            <p className={styles.hint}>Наведите на QR-код ресторана</p>
          </div>
        </div>

        {error && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{error}</p>
            <button className={styles.retryBtn} onClick={() => window.location.reload()}>
              Попробовать снова
            </button>
          </div>
        )}

        {accessDenied && (
          <RestaurantAccessDeniedModal
            onClose={() => {
              localStorage.removeItem('waiter_shift')
              window.location.reload()
            }}
          />
        )}
      </div>
    </div>
  )
}
