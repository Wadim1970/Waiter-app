import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './RegisterScreen.module.css'

export default function RegisterScreen() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [isPhoneFocused, setIsPhoneFocused] = useState(false)

  const handlePhoneFocus = () => {
    setIsPhoneFocused(true)
    if (!phone) {
      setPhone('+7')
    }
  }

  const handlePhoneBlur = () => {
    setIsPhoneFocused(false)
    if (phone === '+7') {
      setPhone('')
    }
  }

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    
    // Если пользователь пытается удалить +7, не даем это сделать
    if (value.startsWith('+7')) {
      setPhone(value)
    } else if (!value) {
      setPhone('')
    } else {
      setPhone('+7' + value)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Валидация
    if (!name.trim()) {
      alert('Пожалуйста, введите ваше имя')
      return
    }
    
    if (!phone || phone.length < 12) {
      alert('Пожалуйста, введите корректный номер телефона')
      return
    }
    
    // Переход на следующий экран
    console.log('Данные:', { name, phone })
    // navigate('/next-step')
  }

  return (
    <main className={styles.container} aria-label="Экран регистрации">
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.inputGroup}>
          <input
            type="text"
            className={styles.input}
            placeholder="Имя"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Введите ваше имя"
          />
        </div>

        <div className={styles.inputGroup}>
          <input
            type="tel"
            className={styles.input}
            placeholder="№ телефона"
            value={phone}
            onChange={handlePhoneChange}
            onFocus={handlePhoneFocus}
            onBlur={handlePhoneBlur}
            maxLength={12}
            aria-label="Введите номер телефона"
          />
        </div>

        <button
          type="submit"
          className={styles.submitButton}
          aria-label="Продолжить регистрацию"
        >
          Далее
        </button>
      </form>
    </main>
  )
}
