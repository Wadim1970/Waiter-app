const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

// applicationServerKey должен быть Uint8Array, а VAPID-ключ у нас как
// URL-safe base64 строка — стандартное преобразование для Push API.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)))
}

// Push работает только для установленного на главный экран приложения
// (iOS 16.4+) — в обычной вкладке браузера pushManager либо отсутствует,
// либо subscribe() всегда падает. Проверяем оба API целиком, а не
// отдельно от display-mode — если чего-то из этого нет, дальше идти
// бессмысленно.
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && !!VAPID_PUBLIC_KEY
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

// Запрашивает разрешение (обязательно из настоящего пользовательского
// жеста — вызывающая кнопка должна звать это напрямую из onClick) и,
// если разрешили, подписывает и сохраняет подписку на сервере.
// Возвращает false молча на любую непредвиденную проблему — это
// дополнительный канал уведомлений, не должен ронять остальной экран.
export async function subscribeToPush(waiterId: string): Promise<boolean> {
  if (!isPushSupported()) return false

  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false

    const registration = await navigator.serviceWorker.ready
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY as string),
      })
    }

    const json = subscription.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false

    const { supabaseWaiter } = await import('./supabase')
    const { error } = await supabaseWaiter.rpc('save_push_subscription', {
      p_waiter_id: waiterId,
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
    })
    if (error) throw error

    return true
  } catch (err) {
    console.error('Не удалось подписаться на push:', err)
    return false
  }
}
