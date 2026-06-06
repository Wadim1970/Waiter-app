import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import styles from './QRScannerScreen.module.css'

export default function QRScannerScreen() {
  const navigate = useNavigate()
  const scannerRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let html5QrcodeScanner: any = null

    const startScanner = async () => {
      try {
        const { Html5QrcodeScanner } = await import('html5-qrcode')

        html5QrcodeScanner = new Html5QrcodeScanner(
          'qr-reader',
          { fps: 10, qrbox: { width: 250, height: 250 } },
          false
        )

        html5QrcodeScanner.render(
          async (decodedText: string) => {
            html5QrcodeScanner?.clear()
            await handleScan(decodedText)
          },
          () => {} // игнорируем ошибки "нет QR в кадре"
        )

        scannerRef.current = html5QrcodeScanner
      } catch {
        setError('Не удалось запустить камеру. Проверьте разрешения.')
      }
    }

    startScanner()
    return () => { scannerRef.current?.clear().catch(() => {}) }
  }, [])

  const handleScan = async (decodedText: string) => {
    setError(null)

    // Извлекаем токен из URL или используем как есть
    let token = decodedText.trim()
    try {
      const url = new URL(decodedText)
      token = url.searchParams.get('token') ?? decodedText
    } catch {
      // не URL — используем как есть
    }

    // Валидируем токен
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabase
      .from('restaurant_daily_tokens')
      .select('restaurant_id')
      .eq('token', token)
      .eq('valid_date', today)
      .maybeSingle()

    if (error || !data) {
      setError('QR-код недействителен или устарел. Попросите администратора обновить QR.')
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
        <p className={styles.hint}>Наведите камеру на QR-код ресторана</p>
        <div id="qr-reader" className={styles.reader} />
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}
