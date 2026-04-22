import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, WaiterRegistration } from '../lib/supabase'
import styles from './RegisterScreen.module.css'

export default function RegisterScreen() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [isPhoneFocused, setIsPhoneFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

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
    
    // Разрешаем только цифры после +7
    const numbers = value.replace(/\D/g, '')
    
    if (numbers.startsWith('7')) {
      setPhone('+' + numbers)
    } else if (!value) {
      setPhone('')
    } else {
      setPhone('+7')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
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

  setIsLoading(true)

  try {
    // 1️⃣ Проверяем существование телефона
    const { data: existingWaiter, error: checkError } = await supabase
      .from('waiters')
      .select('id, phone_verified')
      .eq('phone', phone)
      .maybeSingle()

    if (checkError) {
      console.error('Ошибка при проверке телефона:', checkError)
      alert('Ошибка при проверке данных. Попробуйте снова.')
      setIsLoading(false)
      return
    }

    // 2️⃣ Если телефон найден И верифицирован
    if (existingWaiter && existingWaiter.phone_verified === true) {
      alert('Такой номер уже зарегистрирован в системе. Обратитесь в службу поддержки.')
      setIsLoading(false)
      return
    }

    let waiterId: string

    // 3️⃣ Если телефон найден но НЕ верифицирован - используем существующую запись
    if (existingWaiter && existingWaiter.phone_verified === false) {
      waiterId = existingWaiter.id
      
      // Обновляем имя на случай если пользователь ввёл другое
      await supabase
        .from('waiters')
        .update({ first_name: name.trim() })
        .eq('id', waiterId)
      
      console.log('Используем существующую запись:', waiterId)
    } else {
      // 4️⃣ Создаём новую запись (телефона нет в базе)
      const waiterData: WaiterRegistration = {
        first_name: name.trim(),
        phone: phone,
        employment_type: 'freelance',
        phone_verified: false
      }

      const { data, error } = await supabase
        .from('waiters')
        .insert([waiterData])
        .select()
        .single()

      if (error) {
        console.error('Ошибка при создании записи:', error)
        alert('Ошибка при регистрации. Попробуйте снова.')
        return
      }

      waiterId = data.id
      console.log('Официант зарегистрирован:', data)
    }

    // TODO: Здесь должна быть отправка SMS с кодом вер��фикации
    console.log('Отправка SMS на номер:', phone)

    // Переход на экран верификации
    navigate('/verification', {
      state: {
        phone: phone,
        waiterId: waiterId
      }
    })

  } catch (err) {
    console.error('Непредвиденная ошибка:', err)
    alert('Произошла ошибка. Попробуйте позже.')
  } finally {
    setIsLoading(false)
  }
}

  return (
    <main className={styles.container} aria-label="Экран регистрации">
      {/* Кнопка назад */}
      <button
        type="button"
        onClick={() => navigate('/')}
        className={styles.backButton}
        aria-label="Вернуться на главный экран"
        disabled={isLoading}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M15 18L9 12L15 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.inputGroup}>
          <input
            type="text"
            className={styles.input}
            placeholder="Имя"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
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
            disabled={isLoading}
            aria-label="Введите номер телефона"
          />
        </div>

        <button
          type="submit"
          className={styles.submitButton}
          disabled={isLoading}
          aria-label="Продолжить регистрацию"
        >
          {isLoading ? 'Загрузка...' : 'Далее'}
        </button>
      </form>
    </main>
  )
}
