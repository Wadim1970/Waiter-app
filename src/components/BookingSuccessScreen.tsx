import { useNavigate } from 'react-router-dom'
import styles from './BookingSuccessScreen.module.css'

export default function BookingSuccessScreen() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Смена забронирована</h1>
        
        <button 
          className={styles.button}
          onClick={() => navigate('/map')}
        >
          Вернуться на карту
        </button>
      </div>
    </div>
  )
}
