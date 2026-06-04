import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import styles from './VerificationScreen.module.css'
import { supabase } from '../../lib/supabase'

export default function VerificationScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { phone, waiterId } = location.state || {}
  
  const [code, setCode] = useState(['', '', '', ''])

  useEffect(() => {
    if (!phone || !waiterId) {
      navigate('/register')
      return
    }
  }, [phone, waiterId, navigate])

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
    
    // Получаем данные официанта
    const { data: waiter, error } = await supabase
      .from('waiters')
      .select('id, pin_code, pin_expires_at')
      .eq('id', waiterId)
      .maybeSingle()

    if (error || !waiter) {
      throw new Error('Официант не найден')
    }

    // Проверяем срок действия PIN
    if (!waiter.pin_expires_at) {
      throw new Error('PIN-код не был отправлен. Вернитесь назад и попробуйте снова.')
    }

    const expiresAt = new Date(waiter.pin_expires_at)
    if (expiresAt < new Date()) {
      throw new Error('Код истёк. Вернитесь назад и запросите новый.')
    }

    // Проверяем PIN
    if (waiter.pin_code !== fullCode) {
      throw new Error('Неверный код. Попробуйте снова.')
    }

    // ✅ PIN правильный! Обновляем статус
    const { error: updateError } = await supabase
      .from('waiters')
      .update({
        phone_verified: true,
        pin_code: null, // Очищаем использованный PIN
        pin_expires_at: null
      })
      .eq('id', waiterId)

    if (updateError) throw updateError

    // Сохраняем device_id
    localStorage.setItem('waiter_device_id', waiterId)

    // Переходим в профиль
    navigate('/profile')

  } catch (error: any) {
    console.error('Ошибка верификации:', error)
    alert(error.message || 'Произошла ошибка')
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
