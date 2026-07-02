import { useState } from 'react'
import { cancelBooking, confirmShift } from '../../lib/bookings'
import { getWaiterId } from '../../lib/supabase'
import styles from './ShiftCard.module.css'

interface ShiftCardProps {
  bookingId: string
  restaurantName: string
  address: string
  shiftDate: string // ISO формат: "2025-04-22"
  startTime: string // "09:00:00"
  endTime: string // "23:00:00"
  payAmount: number
  status: 'applied' | 'approved' | 'confirmed'
  onCancel?: () => void // Колбэк после отмены
}

export default function ShiftCard({
  bookingId,
  restaurantName,
  address,
  shiftDate,
  startTime,
  endTime,
  payAmount,
  status,
  onCancel
}: ShiftCardProps) {
  const [isLoading, setIsLoading] = useState(false)

  // Форматируем дату: "22 апреля, вс"
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    const months = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ]
    const weekdays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
    
    const day = date.getDate()
    const month = months[date.getMonth()]
    const weekday = weekdays[date.getDay()]
    
    return `${day} ${month}, ${weekday}`
  }

  // Форматируем время: "09:00-23:00"
  const formatTime = (start: string, end: string): string => {
    return `${start.slice(0, 5)}-${end.slice(0, 5)}`
  }

  // Обработчик отмены
  const handleCancel = async () => {
    if (!confirm('Вы уверены, что хотите отменить эту заявку?')) {
      return
    }

    setIsLoading(true)

    try {
      const waiterId = getWaiterId()
      if (!waiterId) throw new Error('Waiter ID не найден')

      const { error } = await cancelBooking(bookingId, waiterId)

      if (error) {
        throw error
      }

      alert('✅ Заявка успешно отменена')
      
      // Вызываем колбэк для обновления списка
      if (onCancel) {
        onCancel()
      }
    } catch (error: any) {
      console.error('Ошибка отмены:', error)
      alert(`❌ ${error.message || 'Не удалось отменить заявку'}`)
    } finally {
      setIsLoading(false)
    }
  }

  // НОВОЕ: Обработчик подтверждения
  const handleConfirm = async () => {
    if (!confirm('Вы подтверждаете участие в этой смене?')) {
      return
    }

    setIsLoading(true)

    try {
      const waiterId = getWaiterId()
      if (!waiterId) throw new Error('Waiter ID не найден')

      const { error } = await confirmShift(bookingId, waiterId)

      if (error) {
        throw error
      }

      alert('✅ Смена подтверждена!')
      
      // Вызываем колбэк для обновления списка
      if (onCancel) {
        onCancel()
      }
    } catch (error: any) {
      console.error('Ошибка подтверждения:', error)
      alert(`❌ ${error.message || 'Не удалось подтвердить смену'}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={styles.card}>
      {/* Дата */}
      <div className={styles.date}>
        {formatDate(shiftDate)}
      </div>

      {/* Время */}
      <div className={styles.time}>
        {formatTime(startTime, endTime)}
      </div>

      {/* Название ресторана */}
      <div className={styles.restaurantName}>
        {restaurantName.toUpperCase()}
      </div>

      {/* Адрес */}
      <div className={styles.address}>
        {address}
      </div>

      {/* Цена */}
      <div className={styles.price}>
        {Math.round(payAmount)}
      </div>

      {/* Кнопка отмены (только для applied) */}
      {status === 'applied' && (
        <button
          className={styles.cancelButton}
          onClick={handleCancel}
          disabled={isLoading}
        >
          {isLoading ? 'Отмена...' : 'Отменить'}
        </button>
      )}

      {/* Кнопка подтверждения (только для approved) */}
      {status === 'approved' && (
        <button
          className={styles.confirmButton}
          onClick={handleConfirm}
          disabled={isLoading}
        >
          {isLoading ? 'Подтверждение...' : 'Подтвердить'}
        </button>
      )}

      {/* Для confirmed показываем статус */}
      {status === 'confirmed' && (
        <div className={styles.confirmedBadge}>
          ✓ Подтверждено
        </div>
      )}
    </div>
  )
}
