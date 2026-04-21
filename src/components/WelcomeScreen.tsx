import { useNavigate } from 'react-router-dom'
import styles from './WelcomeScreen.module.css'

const logoLetters = [
  { letter: 'R', className: styles.letterR },
  { letter: 'A', className: styles.letterA },
  { letter: 'I', className: styles.letterI },
]

export default function WelcomeScreen() {
  const navigate = useNavigate()

  return (
    <main className={styles.container} aria-label="Экран приветствия">
      

      <img
        className={styles.heroImage}
        alt="Сотрудница ресторана"
        src="/icons/Gemini_Generated_Image_ypcx89ypcx89ypcx-Photoroom.png"
        draggable={false}
      />

      <header className={styles.logo}>
  <span className={styles.letterR}>R</span>
  <div className={styles.logoSubtext}>est</div>
  <div className={styles.logoLetters}>
    <span className={styles.letterA}>A</span>
    <span className={styles.letterI}>I</span>
  </div>
</header>

      <p className={styles.welcomeText}>welcome to family</p>

      <button
        type="button"
        onClick={() => navigate('/login')}
        className={styles.loginButton}
        aria-label="Вход"
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
    </main>
  )
}
