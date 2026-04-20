import { useNavigate } from 'react-router-dom'
import styles from './WelcomeScreen.module.css'

export default function WelcomeScreen() {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        <div className={styles.logo}>
          <div className={styles.logoLetters}>
            <span className={styles.letterR}>R</span>
            <span className={styles.letterA}>A</span>
            <span className={styles.letterI}>I</span>
          </div>
          <div className={styles.logoSubtext}>est</div>
        </div>

        <p className={styles.welcomeText}>welcome to family</p>

        <button 
          type="button"
          onClick={() => navigate('/login')}
          className={styles.loginButton}
        >
          Вход
        </button>

        <div className={styles.registerSection}>
          <button 
            type="button"
            onClick={() => navigate('/register')}
            className={styles.registerLink}
          >
            Регистрация
          </button>
          <p className={styles.registerSubtext}>для ищущих подработку</p>
        </div>
      </div>
    </div>
  )
}
