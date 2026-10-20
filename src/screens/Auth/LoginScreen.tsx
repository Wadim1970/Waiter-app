import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './VerificationScreen.module.css'
import { loginByCode } from '../../lib/demoAuth'

// Кнопка «Вход» на главном экране → 4 цифры. Сейчас по коду входит демо-
// официант «Сыроварни» (для показа рестораторам), позже сюда же — коды
// штатных официантов. Оформление — как у экрана кода из SMS.
export default function LoginScreen() {
  const navigate = useNavigate()
  const [code, setCode] = useState(['', '', '', ''])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.getElementById('login-code-0')?.focus()
  }, [])

  const submit = async (digits: string[]) => {
    const fullCode = digits.join('')
    if (fullCode.length < 4 || busy) return
    setBusy(true)
    setError('')
    try {
      const { restaurantId } = await loginByCode(fullCode)
      navigate(`/restaurant/tables?restaurant=${restaurantId}`, { replace: true })
    } catch (err: any) {
      setError(err.message || 'Неверный код')
      setCode(['', '', '', ''])
      document.getElementById('login-code-0')?.focus()
    } finally {
      setBusy(false)
    }
  }

  const handleCodeChange = (index: number, value: string) => {
    if (value.length > 1) return
    if (value && !/^\d$/.test(value)) return
    const next = [...code]
    next[index] = value
    setCode(next)
    setError('')
    if (value && index < 3) document.getElementById(`login-code-${index + 1}`)?.focus()
    // Четвёртая цифра — входим сразу, без нажатия «ОК».
    if (value && next.every(Boolean)) submit(next)
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      document.getElementById(`login-code-${index - 1}`)?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted) return
    const next = pasted.split('').concat(['', '', '', '']).slice(0, 4)
    setCode(next)
    if (next.every(Boolean)) submit(next)
    else document.getElementById(`login-code-${next.findIndex((d) => !d)}`)?.focus()
  }

  return (
    <main className={styles.container} aria-label="Вход по коду">
      <button
        type="button"
        onClick={() => navigate('/')}
        className={styles.backButton}
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
        <div className={styles.codeInputsContainer}>
          <div className={styles.codeInputs}>
            {code.map((digit, index) => (
              <input
                key={index}
                id={`login-code-${index}`}
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                maxLength={1}
                value={digit}
                disabled={busy}
                onChange={(e) => handleCodeChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                onPaste={handlePaste}
                className={styles.codeInput}
                aria-label={`Цифра ${index + 1}`}
              />
            ))}
          </div>
          <p className={styles.hint} role={error ? 'alert' : undefined}>
            {error || 'Введите код входа'}
          </p>
        </div>

        <button
          type="submit"
          className={styles.submitButton}
          disabled={busy || code.some((d) => !d)}
          aria-label="Войти"
        >
          {busy ? '…' : 'ОК'}
        </button>
      </form>
    </main>
  )
}
