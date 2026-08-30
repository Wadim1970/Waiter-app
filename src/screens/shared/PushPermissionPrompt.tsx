import { useEffect, useRef, useState } from 'react'
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

    // Разрешение уже выдано → ТИХО переподписываемся при каждом открытии.
    // Push-подписка со временем протухает/сбрасывается (браузер меняет
    // endpoint, ОС чистит), сервер удаляет её по 404/410 — и вызов
    // переставал доходить в фоне, всплывая лишь при возврате в приложение.
    // subscribeToPush идемпотентна: берёт текущую подписку (или создаёт
    // новую) и заново сохраняет её на сервере. Баннер при этом не нужен.
    if (getNotificationPermission() === 'granted') {
      let cancelled = false
      ;(async () => {
        const id = getWaiterId() ?? (await resolveWaiterId())
        if (!cancelled && id) subscribeToPush(id).catch(() => {})
      })()
      return () => { cancelled = true }
    }

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

  // Освежаем push-подписку при ВОЗВРАТЕ в приложение из фона (resume) — не
  // только при холодном старте. Именно тогда официант «будит» приложение
  // после сна, и подписка должна быть валидной. Троттлинг — не чаще раза в
  // минуту, чтобы не дёргать сервер на каждое переключение.
  const lastPushRefreshRef = useRef(0)
  useEffect(() => {
    if (!isPushSupported()) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (getNotificationPermission() !== 'granted') return
      const now = Date.now()
      if (now - lastPushRefreshRef.current < 60000) return
      lastPushRefreshRef.current = now
      ;(async () => {
        const id = getWaiterId() ?? (await resolveWaiterId())
        if (id) subscribeToPush(id).catch(() => {})
      })()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
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
