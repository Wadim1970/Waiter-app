import { useEffect } from 'react'
import { getWaiterId, resolveWaiterId, supabaseWaiter } from '../../lib/supabase'
import { getUnseenApprovedCount } from '../../lib/bookings'

// Badging API — значок с числом поверх иконки приложения на главном
// экране. Работает ТОЛЬКО для установленного PWA (manifest display:
// standalone, Add to Home Screen) — в обычной вкладке браузера API
// нет вообще, вызов просто не выполнится. На iOS — Safari 16.4+, тоже
// только для иконки на главном экране, не для вкладки Safari.
//
// Значок обновляется, пока приложение открыто или недавно свёрнуто
// (тот же принцип, что и с Realtime/звуком у WaiterCallOverlay) — это
// НЕ push-уведомление, при полностью закрытом/выгруженном приложении
// обновляться он не будет: для этого нужен настоящий Web Push с
// отдельным сервером и подпиской по VAPID-ключам.
function setBadge(count: number) {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  if (!nav.setAppBadge || !nav.clearAppBadge) return
  if (count > 0) {
    nav.setAppBadge(count).catch(() => {})
  } else {
    nav.clearAppBadge().catch(() => {})
  }
}

// Живёт глобально в App.tsx, а не внутри Footer — Footer размонтирован
// на части экранов, а значок на иконке должен обновляться в любой
// момент, пока приложение открыто, независимо от того, какой сейчас
// экран (тот же принцип, что и у WaiterCallOverlay).
export default function AppBadgeSync() {
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: unknown }
    if (!nav.setAppBadge) return // Badging API не поддерживается — тихо выходим

    let channel: ReturnType<typeof supabaseWaiter.channel> | null = null
    let cancelled = false

    const init = async () => {
      const waiterId = getWaiterId() ?? (await resolveWaiterId())
      if (!waiterId || cancelled) return

      const refresh = () => {
        getUnseenApprovedCount(waiterId).then(count => {
          if (!cancelled) setBadge(count)
        })
      }
      refresh()

      channel = supabaseWaiter
        .channel(`app_badge:${waiterId}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'bookings', filter: `worker_id=eq.${waiterId}` },
          refresh
        )
        .subscribe()
    }
    init()

    return () => {
      cancelled = true
      if (channel) supabaseWaiter.removeChannel(channel)
    }
  }, [])

  return null
}
