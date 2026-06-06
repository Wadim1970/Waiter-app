import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import styles from './QRScannerScreen.module.css'

export default function QRScannerScreen() {
  const navigate = useNavigate()
  const scannerRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

  useEffect(() => {
    let qrScanner: any = null
    let stopped = false

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode')

        qrScanner = new Html5Qrcode('qr-video')
        scannerRef.current = qrScanner

        await qrScanner.start(
          { facingMode: 'environment' }, // задняя камера
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText: string) => {
            if (stopped) return
            stopped = true
            await qrScanner.stop()
            await handleScan(decodedText)
          },
          () => {} // игнорируем "нет QR в кадре"
        )

        setScanning(true)
      } catch (e: any) {
        if (e?.message?.includes('Permission')) {
          setError('Нет доступа к камере. Разрешите доступ в настройках браузера.')
        } else {
          setError('Не удалось запустить камеру.')
        }
      }
    }

    startScanner()

    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {})
      }
    }
  }, [])

  const handleScan = async (decodedText: string) => {
    setError(null)

    let token = decodedText.trim()
    try {
      const url = new URL(decodedText)
      token = url.searchParams.get('token') ?? decodedText
    } catch {
      // не URL — используем как есть
    }

    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('restaurant_daily_tokens')
      .select('restaurant_id')
      .eq('token', token)
      .eq('valid_date', today)
      .maybeSingle()

    if (error || !data) {
      setError('QR-код недействителен или устарел.')
      setScanning(false)
      return
    }

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
          <div id="qr-video" className={styles.video} />
          {scanning && (
            <div className={styles.overlay}>
              <div className={styles.corner} />
              <p className={styles.hint}>Наведите на QR-код ресторана</p>
            </div>
          )}
        </div>

        {error && (
          <div className={styles.errorBox}>
            <p className={styles.errorText}>{error}</p>
            <button className={styles.retryBtn} onClick={() => window.location.reload()}>
              Попробовать снова
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
