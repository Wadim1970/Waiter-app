import { useNavigate } from 'react-router-dom'
import styles from './Footer.module.css'

export default function Footer() {
  const navigate = useNavigate()

  return (
    <footer className={styles.footer}>
      <button 
        className={styles.iconButton}
        onClick={() => navigate('/search')}
        aria-label="Поиск"
      >
        <img src="/icons/lupa.png" alt="Поиск" className={styles.icon} />
      </button>

      <button 
        className={styles.iconButton}
        onClick={() => navigate('/orders')}
        aria-label="Заказы"
      >
        <img src="/icons/orders.png" alt="Заказы" className={styles.icon} />
      </button>

      <button 
        className={styles.iconButton}
        onClick={() => navigate('/map')}
        aria-label="Главная"
      >
        <img src="/icons/Home-logo.png" alt="Главная" className={styles.homeIcon} />
      </button>

      <button 
        className={styles.iconButton}
        onClick={() => navigate('/finance')}
        aria-label="Финансы"
      >
        <img src="/icons/finance.png" alt="Финансы" className={styles.icon} />
      </button>

      <button 
        className={styles.iconButton}
        onClick={() => navigate('/profile')}
        aria-label="Профиль"
      >
        <img src="/icons/lk.png" alt="Профиль" className={styles.icon} />
      </button>
    </footer>
  )
}
