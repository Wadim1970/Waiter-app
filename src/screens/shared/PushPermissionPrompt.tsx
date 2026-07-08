import { useEffect, useState } from 'react'
import { getWaiterId, resolveWaiterId } from '../../lib/supabase'
import { isPushSupported, getNotificationPermission, subscribeToPush } from '../../lib/pushSubscription'
import styles from './PushPermissionPrompt.module.css'

const DISMISSED_KEY = 'push_prompt_dismissed'

// Ненавязчивый баннер "включить push", а не автоматический запрос при
// загрузке — системный диалог разрешений можно показать только один
// раз осмысленно: если официант случайно отклонит его на пустом месте
// при первом открытии приложения, повторно спросить кодом уже нельзя
// (только вручную через настройки телефона).
export default function PushPermissionPrompt() {
  const [visible, setVisible] = useState(false)
  const [waiterId, setWaiterId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isPushSupported()) return
    if (getNotificationPermission() !== 'default') return
    if (localStorage.getItem(DISMISSED_KEY)) return

    let cancelled = false
    ;(async () => {
      const id = getWaiterId() ?? (await resolveWaiterId())
      if (!cancelled && id) {
        setWaiterId(id)
        setVisible(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }

  const handleEnable = async () => {
    if (!waiterId || busy) return
    setBusy(true)
    await subscribeToPush(waiterId)
    // И при успехе, и при отказе в системном диалоге — повторно спросить
    // кодом нельзя, поэтому баннер в любом случае больше не показываем.
    localStorage.setItem(DISMISSED_KEY, '1')
    setBusy(false)
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <p className={styles.title}>Включить уведомления?</p>
        <p className={styles.subtitle}>Вызов официанта дойдёт, даже если приложение свёрнуто</p>
      </div>
      <div className={styles.actions}>
        <button className={styles.enableButton} onClick={handleEnable} disabled={busy}>
          Включить
        </button>
        <button className={styles.dismissButton} onClick={dismiss} aria-label="Закрыть">
          ×
        </button>
      </div>
    </div>
  )
}
