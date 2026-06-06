import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './QRScannerScreen.module.css'

export default function QRScannerScreen() {
  const navigate = useNavigate()
  const scannerRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)

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
          (decodedText: string) => {
            // QR должен содержать restaurant_id
            // Формат: https://waiter-app.com/restaurant?id=UUID
            // или просто UUID
            let restaurantId = decodedText.trim()

            try {
              const url = new URL(decodedText)
              restaurantId = url.searchParams.get('id') ?? decodedText
            } catch {
              // не URL — используем как есть
            }

            html5QrcodeScanner?.clear()
            navigate(`/restaurant/tables?restaurant=${restaurantId}`)
          },
          (err: any) => {
            // игнорируем ошибки сканирования (нет QR в кадре)
          }
        )

        setScanning(true)
        scannerRef.current = html5QrcodeScanner
      } catch (e) {
        setError('Не удалось запустить камеру. Проверьте разрешения.')
      }
    }

    startScanner()

    return () => {
      scannerRef.current?.clear().catch(() => {})
    }
  }, [navigate])

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
