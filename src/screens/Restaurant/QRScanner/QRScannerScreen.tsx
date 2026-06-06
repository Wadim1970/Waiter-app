import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import styles from './QRScannerScreen.module.css'

export default function QRScannerScreen() {
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let controls: { stop: () => void } | null = null

    const startScanner = async () => {
      try {
        const { BrowserQRCodeReader, BrowserCodeReader } = await import('@zxing/browser')

        const codeReader = new BrowserQRCodeReader()

        const videoInputDevices = await BrowserCodeReader.listVideoInputDevices()
        // Выбираем заднюю камеру
        const backCamera = videoInputDevices.find(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('environment')
        ) ?? videoInputDevices[videoInputDevices.length - 1]

        const deviceId = backCamera?.deviceId

        controls = await codeReader.decodeFromVideoDevice(
          deviceId,
          videoRef.current!,
          async (result, err) => {
            if (stopped || !result) return
            stopped = true
            controls?.stop()
            await handleScan(result.getText())
          }
        )
      } catch (e: any) {
        setError('Не удалось запустить камеру. Проверьте разрешения.')
      }
    }

    startScanner()

    return () => {
      stopped = true
      controls?.stop()
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
      </div>
    </div>
  )
}
