import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { sendSmsCode } from '../../lib/api'
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
    if (!value) {
      setPhone('')
      return
    }
    // Только цифры после +7. Ведущую «8» (по привычке: 8 903…) и номер,
    // вставленный целиком (8 903… / +7 903…), приводим к +7 9… — иначе
    // выходило «+7 890…», и SMS-шлюз отбрасывал номер как неверный.
    let digits = value.replace(/\D/g, '')
    if (digits.startsWith('7')) digits = digits.slice(1)
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) digits = digits.slice(1)
    else if (digits[0] === '8') digits = digits.slice(1)
    setPhone('+7' + digits.slice(0, 10))
  }

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!name.trim() || !phone.trim()) {
    alert('Пожалуйста, заполните все поля');
    return;
  }
  // Мобильный: Россия +7 9…, Казахстан +7 7…
  if (!/^\+7[79]\d{9}$/.test(phone.trim())) {
    alert('Введите мобильный номер полностью: +7 9XX XXX XX XX');
    return;
  }

  setIsLoading(true);

  try {
    // Запрашиваем SMS-код. Создание/привязка waiter'а произойдёт на бэкенде
    // при подтверждении кода (verify-sms), личность подтвердит JWT.
    await sendSmsCode(phone.trim());

    // Имя передаём дальше — сохраним в профиль после входа.
    navigate('/verification', {
      state: {
        phone: phone.trim(),
        name: name.trim(),
      },
    });
  } catch (error: any) {
    console.error('Ошибка регистрации:', error);
    alert(error.message || 'Произошла ошибка. Попробуйте снова.');
  } finally {
    setIsLoading(false);
  }
};

  

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
