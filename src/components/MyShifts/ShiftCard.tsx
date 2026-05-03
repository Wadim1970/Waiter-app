import { useState } from 'react'
import { cancelBooking } from '../../lib/bookings'
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
      const waiterId = localStorage.getItem('waiter_device_id')
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

  return (
    <div className={styles.card}>
      {/* Дата */}
      <div className={styles.date}>
        {formatDate(shiftDate)}
      </div>

      {/* Цена */}
      <div className={styles.price}>
        {Math.round(payAmount)}
      </div>

      {/* Название ресторана */}
      <div className={styles.restaurantName}>
        {restaurantName.toUpperCase()}
      </div>

      {/* Адрес */}
      <div className={styles.address}>
        {address}
      </div>

      {/* Время */}
      <div className={styles.time}>
        {formatTime(startTime, endTime)}
      </div>

      {/* Кнопка отмены (только для applied и approved) */}
      {(status === 'applied' || status === 'approved') && (
        <button
          className={styles.cancelButton}
          onClick={handleCancel}
          disabled={isLoading}
        >
          {isLoading ? 'Отмена...' : 'Отменить'}
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
