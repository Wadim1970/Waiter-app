import { useState, useEffect } from 'react'
import styles from './Header.module.css'

interface HeaderProps {
  selectedDate: Date
  onDateSelect: (date: Date) => void
}

export default function Header({ selectedDate, onDateSelect }: HeaderProps) {
  const [weekDays, setWeekDays] = useState<Date[]>([])

  useEffect(() => {
    generateWeekDays()
  }, [])

  const generateWeekDays = () => {
    const days: Date[] = []
    const today = new Date()
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(today)
      date.setDate(today.getDate() + i)
      days.push(date)
    }
    
    setWeekDays(days)
  }

  const getMonthName = () => {
    const months = [
      'ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ',
      'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'
    ]
    return months[selectedDate.getMonth()]
  }

  const getDayName = (date: Date) => {
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    return days[date.getDay()]
  }

  const isWeekend = (date: Date) => {
    const day = date.getDay()
    return day === 0 || day === 6
  }

  const isSameDay = (date1: Date, date2: Date) => {
    return date1.toDateString() === date2.toDateString()
  }

  return (
    <header className={styles.header}>
      <div className={styles.monthName}>{getMonthName()}</div>
      
      <div className={styles.calendar}>
        {weekDays.map((date, index) => (
          <button
            key={index}
            className={`${styles.dayFrame} ${isSameDay(date, selectedDate) ? styles.selected : ''}`}
            onClick={() => onDateSelect(date)}
          >
            <span className={styles.dayName}>{getDayName(date)}</span>
            <div className={`${styles.dateCircle} ${isWeekend(date) ? styles.weekend : ''}`}>
              {date.getDate().toString().padStart(2, '0')}
            </div>
          </button>
        ))}
      </div>
    </header>
  )
}
