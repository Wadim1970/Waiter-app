import { useNavigate, useLocation } from 'react-router-dom'
import styles from './Footer.module.css'

export default function Footer() {
  const navigate = useNavigate()
  const location = useLocation()

  const isActive = (path: string) => location.pathname === path

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
      </button>

      {/* СКАНЕР QR → СТОЛЫ РЕСТОРАНА */}
      <button
        className={`${styles.iconButton} ${isActive('/restaurant/scan') || isActive('/restaurant/tables') ? styles.active : ''}`}
        onClick={() => navigate('/restaurant/scan')}
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
