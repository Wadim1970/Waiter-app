import styles from './WorkingShiftCard.module.css'

interface WorkingShiftCardProps {
  restaurantName: string
  address: string
  shiftDate: string // ISO формат: "2026-04-17"
  startTime: string // "09:00:00"
  endTime: string   // "23:00:00"
}

export default function WorkingShiftCard({
  restaurantName,
  address,
  shiftDate,
  startTime,
  endTime
}: WorkingShiftCardProps) {
  
  // Форматируем дату
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    
    const weekdays = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    const months = [
      'янв', 'фев', 'мар', 'апр', 'май', 'июн',
      'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'
    ]
    
    const weekday = weekdays[date.getDay()]
    const day = date.getDate()
    const month = months[date.getMonth()]
    
    return { weekday, day, month }
  }

  const { weekday, day, month } = formatDate(shiftDate)

  const formatTime = (start: string, end: string): string => {
  return `${start.slice(0, 5)}-${end.slice(0, 5)}`
}

 return (
  <div className={styles.card}>
    {/* Фон с градиентом */}
    <div className={styles.gradient} />
    
    {/* Название ресторана */}
    <div className={styles.restaurantName}>
      {restaurantName.toUpperCase()}
    </div>
    
    {/* Адрес */}
    <div className={styles.address}>{address}</div>
    
    {/* НОВОЕ: Дата справа (Ср 17 апр) */}
    <div className={styles.dateInfo}>
      <span className={styles.weekday}>{weekday}</span>
      <span className={styles.day}>{day}</span>
      <span className={styles.month}>{month}</span>
    </div>
    
    {/* НОВОЕ: Время смены справа внизу */}
    <div className={styles.timeInfo}>
      {formatTime(startTime, endTime)}
    </div>
  </div>
)
}
