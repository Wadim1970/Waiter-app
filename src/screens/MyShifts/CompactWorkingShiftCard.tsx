import { useState, useRef, useEffect } from 'react'
import styles from './CompactWorkingShiftCard.module.css'

interface CompactWorkingShiftCardProps {
  restaurantName: string
  shiftDate: string
  onClick: () => void
}

export default function CompactWorkingShiftCard({
  restaurantName,
  shiftDate,
  onClick
}: CompactWorkingShiftCardProps) {
  const [cardWidth, setCardWidth] = useState(0)
  const textRef = useRef<HTMLDivElement>(null)

  // Форматируем дату
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    
    const months = [
      'янв', 'фев', 'мар', 'апр', 'май', 'июн',
      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'
    ]
    
    const day = date.getDate()
    const month = months[date.getMonth()]
    
    return { day, month }
  }

  const { day, month } = formatDate(shiftDate)

  // Вычисляем ширину карточки на основе названия
  useEffect(() => {
    if (textRef.current) {
      const textWidth = textRef.current.offsetWidth
      setCardWidth(textWidth + 48) // +48px (24px слева + 24px справа)
    }
  }, [restaurantName])

  return (
    <div 
      className={styles.card} 
      style={{ width: cardWidth || 'auto' }}
      onClick={onClick}
    >
      {/* Фон с градиентом */}
      <div className={styles.gradient} />
      
      {/* Название ресторана (для измерения ширины) */}
      <div className={styles.restaurantName} ref={textRef}>
        {restaurantName.toUpperCase()}
      </div>
      
      {/* Дата (число) */}
      <div className={styles.day}>{day}</div>
      
      {/* Месяц */}
      <div className={styles.month}>{month}</div>
    </div>
  )
}
