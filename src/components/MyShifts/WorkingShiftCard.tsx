import styles from './WorkingShiftCard.module.css'

interface WorkingShiftCardProps {
  restaurantName: string
  address: string
  shiftDate: string // ISO формат: "2026-04-17"
}

export default function WorkingShiftCard({
  restaurantName,
  address,
  shiftDate
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

  return (
    <div className={styles.card}>
      {/* Фон с градиентом */}
      <div className={styles.gradient} />
      
      {/* День недели (Вс) */}
      <div className={styles.weekday}>{weekday}</div>
      
      {/* Название ресторана */}
      <div className={styles.restaurantName}>
        {restaurantName.toUpperCase()}
      </div>
      
      {/* Адрес */}
      <div className={styles.address}>{address}</div>
      
      {/* День (17) */}
      <div className={styles.day}>{day}</div>
      
      {/* Месяц (апр) */}
      <div className={styles.month}>{month}</div>
    </div>
  )
}
