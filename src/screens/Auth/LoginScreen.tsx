import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import verification from './VerificationScreen.module.css'
import styles from './LoginScreen.module.css'
import { loginByCode } from '../../lib/demoAuth'

const CODE_LENGTH = 4

// Кнопка «Вход» на главном экране → 4 цифры. Сейчас по коду входит демо-
// официант «Сыроварни» (для показа рестораторам), позже сюда же — коды
// штатных официантов. Оформление — как у экрана кода из SMS.
//
// Поле ввода ОДНО (четыре «клетки» — только отрисовка его содержимого). Раньше
// было четыре отдельных поля, и после каждой цифры фокус перескакивал в
// следующее: на телефоне клавиатура от этого моргала, а вместе с ней дёргался
// экран. Теперь фокус не двигается ни при вводе, ни при неверном коде.
export default function LoginScreen() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = async (value: string) => {
    if (value.length < CODE_LENGTH || busy) return
    setBusy(true)
    setError('')
    try {
      const { restaurantId } = await loginByCode(value)
      navigate(`/restaurant/tables?restaurant=${restaurantId}`, { replace: true })
    } catch (err: any) {
      setError(err.message || 'Неверный код')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  const handleChange = (raw: string) => {
    if (busy) return
    const next = raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(next)
    setError('')
    // Последняя цифра — входим сразу, без нажатия «ОК».
    if (next.length === CODE_LENGTH) submit(next)
  }

  // Какая клетка сейчас «активная» (с рамкой): следующая за введёнными.
  const activeCell = Math.min(code.length, CODE_LENGTH - 1)

  return (
    <main className={styles.container} aria-label="Вход по коду">
      <button
        type="button"
        onClick={() => navigate('/')}
        className={verification.backButton}
        aria-label="Вернуться назад"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <form
        className={styles.form}
        onSubmit={(e) => { e.preventDefault(); submit(code) }}
      >
        <div className={verification.codeInputsContainer}>
          <div className={styles.codeBox}>
            <div className={verification.codeInputs} aria-hidden="true">
              {Array.from({ length: CODE_LENGTH }, (_, index) => (
                <div
                  key={index}
                  className={`${verification.codeInput} ${styles.cell} ${focused && index === activeCell ? styles.cellActive : ''}`}
                >
                  {code[index] ?? ''}
                </div>
              ))}
            </div>
            <input
              ref={inputRef}
              id="login-code"
              type="tel"
              inputMode="numeric"
              autoComplete="off"
              maxLength={CODE_LENGTH}
              value={code}
              // Не disabled: у отключённого поля телефон убирает фокус и закрывает клавиатуру.
              readOnly={busy}
              aria-busy={busy}
              onChange={(e) => handleChange(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className={styles.codeField}
              aria-label="Код входа, четыре цифры"
            />
          </div>
          <p className={styles.hint} role={error ? 'alert' : undefined}>
            {error || 'Введите код входа'}
          </p>
        </div>

        <button
          type="submit"
          className={styles.submitButton}
          disabled={busy || code.length < CODE_LENGTH}
          aria-label="Войти"
        >
          {busy ? '…' : 'ОК'}
        </button>
      </form>
    </main>
  )
}
