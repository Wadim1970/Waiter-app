import { useState, useEffect } from 'react'
import { getMyShifts, ShiftWithDetails } from '../../lib/bookings'
import ShiftCard from './ShiftCard'
import Footer from '../Footer'
import styles from './MyShiftsScreen.module.css'

type MainTab = 'active' | 'past'
type SubTab = 'approved' | 'waiting'

export default function MyShiftsScreen() {
  const [mainTab, setMainTab] = useState<MainTab>('active')
  const [subTab, setSubTab] = useState<SubTab>('waiting')
  
  const [waitingShifts, setWaitingShifts] = useState<ShiftWithDetails[]>([])
  const [approvedShifts, setApprovedShifts] = useState<ShiftWithDetails[]>([])
  const [confirmedShifts, setConfirmedShifts] = useState<ShiftWithDetails[]>([])
  const [loading, setLoading] = useState(true)

  const waiterId = localStorage.getItem('waiter_device_id')

  // Загрузка смен
  useEffect(() => {
    loadShifts()
  }, [])

  const loadShifts = async () => {
    if (!waiterId) {
      console.error('Waiter ID не найден')
      return
    }

    setLoading(true)

    try {
      // Загружаем все статусы параллельно
      const [waiting, approved, confirmed] = await Promise.all([
        getMyShifts(waiterId, 'applied'),
        getMyShifts(waiterId, 'approved'),
        getMyShifts(waiterId, 'confirmed')
      ])

      if (waiting.data) setWaitingShifts(waiting.data)
      if (approved.data) setApprovedShifts(approved.data)
      if (confirmed.data) setConfirmedShifts(confirmed.data)
    } catch (error) {
      console.error('Ошибка загрузки смен:', error)
    } finally {
      setLoading(false)
    }
  }

  // Фильтрация по активным/прошедшим
  const filterByDate = (shifts: ShiftWithDetails[]) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  return shifts
    .filter(shift => {
      const shiftDate = new Date(shift.job.shift_date)
      shiftDate.setHours(0, 0, 0, 0)

      if (mainTab === 'active') {
        return shiftDate >= today
      } else {
        return shiftDate < today
      }
    })
    .sort((a, b) => {
      const dateA = new Date(a.job.shift_date).getTime()
      const dateB = new Date(b.job.shift_date).getTime()
      
      if (mainTab === 'active') {
        return dateA - dateB // Активные: ближайшие сверху
      } else {
        return dateB - dateA // Прошедшие: недавние сверху
      }
    })
}

  const filteredWaiting = filterByDate(waitingShifts)
  const filteredApproved = filterByDate(approvedShifts)
  const filteredConfirmed = filterByDate(confirmedShifts)

  return (
    <div className={styles.container}>
      
      {/* ХЕДЕР */}
      <div className={styles.header}>
        <h1 className={styles.title}>МОИ СМЕНЫ</h1>
        
        <div className={styles.mainTabs}>
          <button
            className={`${styles.mainTab} ${mainTab === 'active' ? styles.mainTabActive : ''}`}
            onClick={() => setMainTab('active')}
          >
            Активные
            {mainTab === 'active' && <div className={styles.mainTabIndicator} />}
          </button>
          
          <button
            className={`${styles.mainTab} ${mainTab === 'past' ? styles.mainTabActive : ''}`}
            onClick={() => setMainTab('past')}
          >
            Прошедшие
            {mainTab === 'past' && <div className={styles.mainTabIndicator} />}
          </button>
        </div>
      </div>

      {/* РАБОЧИЕ СМЕНЫ */}
      <div className={styles.workingShiftsSection}>
        <h2 className={styles.sectionTitle}>РАБОЧИЕ СМЕНЫ</h2>
        
        {filteredConfirmed.length === 0 ? (
          <div className={styles.placeholder}>
            У Вас пока нет рабочих смен
          </div>
        ) : (
          <div className={styles.shiftsList}>
            {filteredConfirmed.map(shift => (
              <ShiftCard
                key={shift.id}
                bookingId={shift.id}
                restaurantName={shift.job.restaurant.name}
                address={shift.job.restaurant.address}
                shiftDate={shift.job.shift_date}
                startTime={shift.job.start_time}
                endTime={shift.job.end_time}
                payAmount={shift.job.pay_amount}
                status="confirmed"
                onCancel={loadShifts}
              />
            ))}
          </div>
        )}
      </div>

      {/* ОДОБРЕНЫ / ОЖИДАЮТ */}
      <div className={styles.approvalSection}>
        <div className={styles.subTabs}>
          <button
            className={`${styles.subTab} ${subTab === 'approved' ? styles.subTabActive : ''}`}
            onClick={() => setSubTab('approved')}
          >
            ОДОБРЕНЫ
          </button>
          
          <button
            className={`${styles.subTab} ${subTab === 'waiting' ? styles.subTabActive : ''}`}
            onClick={() => setSubTab('waiting')}
          >
            ОЖИДАЮТ
          </button>
        </div>

        <div className={styles.shiftsContent}>
          {subTab === 'approved' && (
            <>
              {filteredApproved.length === 0 ? (
                <div className={styles.placeholder}>
                  У Вас пока нет одобренных смен
                </div>
              ) : (
                <div className={styles.shiftsList}>
                  {filteredApproved.map(shift => (
                    <ShiftCard
                      key={shift.id}
                      bookingId={shift.id}
                      restaurantName={shift.job.restaurant.name}
                      address={shift.job.restaurant.address}
                      shiftDate={shift.job.shift_date}
                      startTime={shift.job.start_time}
                      endTime={shift.job.end_time}
                      payAmount={shift.job.pay_amount}
                      status="approved"
                      onCancel={loadShifts}
                    />
                  ))}
                </div>
              )}
            </>
          )}
          
          {subTab === 'waiting' && (
            <>
              {filteredWaiting.length === 0 ? (
                <div className={styles.placeholder}>
                  У Вас пока нет смен, ожидающих одобрения
                </div>
              ) : (
                <div className={styles.shiftsList}>
                  {filteredWaiting.map(shift => (
                    <ShiftCard
                      key={shift.id}
                      bookingId={shift.id}
                      restaurantName={shift.job.restaurant.name}
                      address={shift.job.restaurant.address}
                      shiftDate={shift.job.shift_date}
                      startTime={shift.job.start_time}
                      endTime={shift.job.end_time}
                      payAmount={shift.job.pay_amount}
                      status="applied"
                      onCancel={loadShifts}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Footer />
    </div>
  )
}
