import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import styles from './VerificationScreen.module.css'
import { supabase, setWaiterId } from '../../lib/supabase'
import { verifySms } from '../../lib/api'

export default function VerificationScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { phone, name } = location.state || {}

  const [code, setCode] = useState(['', '', '', ''])

  useEffect(() => {
    if (!phone) {
      navigate('/register')
      return
    }
  }, [phone, navigate])

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) return
    
    // Разрешаем только цифры
    if (value && !/^\d$/.test(value)) return
    
    const newCode = [...code]
    newCode[index] = value
    setCode(newCode)

    // Автоматический переход к следующему полю
    if (value && index < 3) {
      const nextInput = document.getElementById(`code-${index + 1}`)
      nextInput?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      const prevInput = document.getElementById(`code-${index - 1}`)
      prevInput?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    
    if (pastedData.length > 0) {
      const newCode = pastedData.split('').concat(['', '', '', '']).slice(0, 4)
      setCode(newCode)
      
      // Фокус на следующее пустое поле или последнее
      const nextEmptyIndex = newCode.findIndex(digit => !digit)
      const focusIndex = nextEmptyIndex === -1 ? 3 : nextEmptyIndex
      const input = document.getElementById(`code-${focusIndex}`)
      input?.focus()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()

  const fullCode = code.join('')

  if (fullCode.length < 4) {
    alert('Пожалуйста, введите полный PIN код')
    return
  }

  try {
    // Бэкенд проверяет код и возвращает настоящую сессию Supabase.
    const result = await verifySms(phone, fullCode)

    // Устанавливаем сессию — дальше supabase-js сам носит JWT во всех запросах,
    // а RLS на стороне БД проверяет auth.uid().
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
    })
    if (sessionError) throw sessionError

    // Кэшируем waiters.id для синхронного чтения в экранах.
    setWaiterId(result.user.waiter_id)

    // Сохраняем имя в профиль (если пришли с экрана регистрации).
    // Теперь запрос идёт от имени официанта — RLS пропустит только свою запись.
    if (name && name.trim()) {
      await supabase
        .from('waiters')
        .update({ first_name: name.trim() })
        .eq('id', result.user.waiter_id)
    }

    navigate('/profile')
  } catch (error: any) {
    console.error('Ошибка верификации:', error)
    alert(error.message || 'Неверный код. Попробуйте снова.')
  }
}

  return (
    <main className={styles.container} aria-label="Экран верификации">
      {/* Кнопка назад */}
      <button
        type="button"
        onClick={() => navigate('/register')}
        className={styles.backButton}
        aria-label="Вернуться назад"
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
        <div className={styles.codeInputsContainer}>
          <div className={styles.codeInputs}>
            {code.map((digit, index) => (
              <input
                key={index}
                id={`code-${index}`}
                type="tel"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleCodeChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                className={styles.codeInput}
                aria-label={`Цифра ${index + 1}`}
              />
            ))}
          </div>
          <p className={styles.hint}>Введите PIN код из смс</p>
        </div>

        <button
          type="submit"
          className={styles.submitButton}
          aria-label="Подтвердить код"
        >
          ОК
        </button>
      </form>
    </main>
  )
}
