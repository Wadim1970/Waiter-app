import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { getActiveShift } from '../Restaurant/QRScanner/QRScannerScreen'
import { getUnseenApprovedCount } from '../../lib/bookings'
import { getWaiterId, resolveWaiterId, supabaseWaiter } from '../../lib/supabase'
import styles from './Footer.module.css'

export default function Footer() {
  const navigate = useNavigate()
  const location = useLocation()
  const [unseenApproved, setUnseenApproved] = useState(0)

  const isActive = (path: string) => location.pathname === path

  // Бейдж на иконке "Мои смены" — сколько одобрений официант ещё не видел.
  // Footer смонтирован почти на всех экранах, поэтому обновление по
  // Realtime здесь даёт живой бейдж без необходимости отдельного
  // глобального компонента (см. WaiterCallOverlay — там иначе, потому что
  // он должен жить и на экранах без Footer).
  useEffect(() => {
    let channel: ReturnType<typeof supabaseWaiter.channel> | null = null
    let cancelled = false

    const init = async () => {
      const waiterId = getWaiterId() ?? (await resolveWaiterId())
      if (!waiterId || cancelled) return

      const refresh = () => {
        getUnseenApprovedCount(waiterId).then(count => {
          if (!cancelled) setUnseenApproved(count)
        })
      }
      refresh()

      channel = supabaseWaiter
        .channel(`booking_approvals:${waiterId}`)
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

  return (
    <footer className={styles.footer}>
      {/* ПОИСК → КАРТА */}
      <button 
        className={`${styles.iconButton} ${isActive('/map') ? styles.active : ''}`}
        onClick={() => navigate('/map')}
        aria-label="Поиск работы на карте"
      >
        <img src="/icons/lupa.png" alt="Поиск" className={styles.icon} />
      </button>

      {/* ЗАКАЗЫ → МОИ СМЕНЫ */}
      <button
        className={`${styles.iconButton} ${isActive('/my-shifts') ? styles.active : ''}`}
        onClick={() => navigate('/my-shifts')}
        aria-label="Мои смены"
      >
        <img src="/icons/orders.png" alt="Заказы" className={styles.icon} />
        {unseenApproved > 0 && (
          <span className={styles.badge}>{unseenApproved > 9 ? '9+' : unseenApproved}</span>
        )}
      </button>

      {/* СКАНЕР QR → СТОЛЫ РЕСТОРАНА */}
      <button
        className={`${styles.iconButton} ${isActive('/restaurant/scan') || isActive('/restaurant/tables') ? styles.active : ''}`}
        onClick={() => {
          // Смена уже активна — ведём сразу на столы, а не через сканер:
          // иначе на миг рендерится камера, прежде чем сканер сам себя
          // перенаправит (см. redirect-эффект в QRScannerScreen).
          const shift = getActiveShift()
          navigate(shift ? `/restaurant/tables?restaurant=${shift.restaurantId}` : '/restaurant/scan')
        }}
        aria-label="Столы ресторана"
      >
        <img src="/icons/Home-logo.png" alt="Главная" className={styles.homeIcon} />
      </button>

      {/* ФИНАНСЫ */}
      <button 
        className={`${styles.iconButton} ${isActive('/finance') ? styles.active : ''}`}
        onClick={() => navigate('/finance')}
        aria-label="Финансы"
      >
        <img src="/icons/finance.png" alt="Финансы" className={styles.icon} />
      </button>

      {/* ПРОФИЛЬ */}
      <button 
        className={`${styles.iconButton} ${isActive('/profile') ? styles.active : ''}`}
        onClick={() => navigate('/profile')}
        aria-label="Профиль"
      >
        <img src="/icons/lk.png" alt="Профиль" className={styles.icon} />
      </button>
    </footer>
  )
}
