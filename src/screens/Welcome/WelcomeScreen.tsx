import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { resumeFreelancer } from '../../lib/demoAuth'
import styles from './WelcomeScreen.module.css'

const logoLetters = [
  { letter: 'R', className: styles.letterR },
  { letter: 'A', className: styles.letterA },
  { letter: 'I', className: styles.letterI },
]

export default function WelcomeScreen() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)

  // Официант-фрилансер: если на телефоне уже есть его вход (в том числе
  // отложенный на время демо-входа по коду) — сразу в приложение, к его
  // сменам и истории; иначе — регистрация/вход по SMS.
  const handleFreelancer = async () => {
    if (checking) return
    setChecking(true)
    try {
      navigate((await resumeFreelancer()) ? '/map' : '/register')
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className={styles.container} aria-label="Экран приветствия">
      
      {/* Новый логотип вверху */}
      <img
        className={styles.topLogo}
        alt="Логотип RestAI"
        src="/icons/Black.png"
        draggable={false}
      />

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

      {/* Добавляем полосу внизу */}
      <div className={styles.bottomBar}></div>

      <div className={styles.registerSection}>
        <button
          type="button"
          onClick={handleFreelancer}
          className={styles.registerLink}
          disabled={checking}
        >
          Вход для фрилансеров
        </button>
        <p className={styles.registerSubtext}>регистрация и поиск смен</p>
      </div>
    </main>
  )
}
