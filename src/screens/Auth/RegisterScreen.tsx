import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
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
  e.preventDefault(); // ← ДОБАВЬ ЭТУ СТРОКУ!
  
  if (!name.trim() || !phone.trim()) {
    alert('Пожалуйста, заполните все поля');
    return;
  }

  setIsLoading(true);

  try {
    // Получаем или создаём device_id
    let deviceId = localStorage.getItem('waiter_device_id');

    // 1. Проверяем существует ли официант с таким телефоном
    const { data: existingWaiter } = await supabase
      .from('waiters')
      .select('id, phone_verified')
      .eq('phone', phone)
      .maybeSingle();

    let waiterId: string;

    if (existingWaiter) {
      // Официант существует
      waiterId = existingWaiter.id;

      // Обновляем имя
      await supabase
        .from('waiters')
        .update({ first_name: name.trim() })
        .eq('id', waiterId);

      // Если уже верифицирован - пропускаем верификацию
      if (existingWaiter.phone_verified) {
        localStorage.setItem('waiter_device_id', waiterId);
        navigate('/profile');
        return;
      }
    } else {
      // Создаём нового официанта
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem('waiter_device_id', deviceId);
      }

      const { data: newWaiter, error } = await supabase
        .from('waiters')
        .insert({
          first_name: name.trim(),
          phone: phone.trim(),
          device_id: deviceId,
          employment_type: 'freelance',
          phone_verified: false
        })
        .select('id')
        .single();

      if (error) throw error;
      waiterId = newWaiter.id;
    }

    // 2. Вызываем n8n webhook для отправки SMS
    const webhookUrl = import.meta.env.VITE_WEBHOOK_URL;
    const webhookSecret = import.meta.env.VITE_WEBHOOK_SECRET;

    const smsResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Secret': webhookSecret
      },
      body: JSON.stringify({
        waiterId: waiterId,
        phone: phone.trim(),
        name: name.trim()
      })
    });

    if (!smsResponse.ok) {
      const errorData = await smsResponse.json();
      throw new Error(errorData.message || 'Ошибка отправки SMS');
    }

    // 3. Переходим на экран верификации
    navigate('/verification', {
      state: {
        phone: phone.trim(),
        waiterId: waiterId
      }
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
