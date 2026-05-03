import { useNavigate, useLocation } from 'react-router-dom'
import styles from './Footer.module.css'

export default function Footer() {
  const navigate = useNavigate()
  const location = useLocation()

  // Определяем активную страницу
  const isActive = (path: string) => location.pathname === path

  return (
    <footer className={styles.footer}>
      <button 
        className={`${styles.iconButton} ${isActive('/search') ? styles.active : ''}`}
        onClick={() => navigate('/search')}
        aria-label="Поиск"
      >
        <img src="/icons/lupa.png" alt="Поиск" className={styles.icon} />
      </button>

      <button 
        className={`${styles.iconButton} ${isActive('/my-shifts') ? styles.active : ''}`}
        onClick={() => navigate('/my-shifts')}
        aria-label="Заказы"
      >
        <img src="/icons/orders.png" alt="Заказы" className={styles.icon} />
      </button>

      <button 
        className={`${styles.iconButton} ${isActive('/map') ? styles.active : ''}`}
        onClick={() => navigate('/map')}
        aria-label="Главная"
      >
        <img src="/icons/Home-logo.png" alt="Главная" className={styles.homeIcon} />
      </button>

      <button 
        className={`${styles.iconButton} ${isActive('/finance') ? styles.active : ''}`}
        onClick={() => navigate('/finance')}
        aria-label="Финансы"
      >
        <img src="/icons/finance.png" alt="Финансы" className={styles.icon} />
      </button>

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
