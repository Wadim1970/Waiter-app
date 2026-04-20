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
      <div className={styles.bgOverlay} aria-hidden="true" />

      <img
        className={styles.heroImage}
        alt="Сотрудница ресторана"
        src="/gemini-generated-image-ypcx89ypcx89ypcx-photoroom-1.png"
        draggable={false}
      />

      <header className={styles.logo}>
        <div className={styles.logoLetters}>
          {logoLetters.map(({ letter, className }) => (
            <span key={letter} className={className}>
              {letter}
            </span>
          ))}
        </div>
        <div className={styles.logoSubtext}>est</div>
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
