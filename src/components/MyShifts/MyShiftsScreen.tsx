import { useState } from 'react'
import Footer from '../Footer'
import styles from './MyShiftsScreen.module.css'

type MainTab = 'active' | 'past'
type SubTab = 'approved' | 'waiting'

export default function MyShiftsScreen() {
  const [mainTab, setMainTab] = useState<MainTab>('active')
  const [subTab, setSubTab] = useState<SubTab>('approved')

  return (
    <div className={styles.container}>
      
      {/* ХЕДЕР */}
      <div className={styles.header}>
        <h1 className={styles.title}>МОИ СМЕНЫ</h1>
        
        {/* Табы верхнего уровня: Активные / Прошедшие */}
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
        
        <div className={styles.placeholder}>
          У Вас пока нет рабочих смен
        </div>
      </div>

      {/* ОДОБРЕНЫ / ОЖИДАЮТ */}
      <div className={styles.approvalSection}>
        {/* Табы: Одобрены / Ожидают */}
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

        {/* Контент в зависимости от выбранного таба */}
        <div className={styles.shiftsContent}>
          {subTab === 'approved' && (
            <div className={styles.placeholder}>
              У Вас пока нет одобренных смен
            </div>
          )}
          
          {subTab === 'waiting' && (
            <div className={styles.placeholder}>
              У Вас пока нет смен, ожидающих одобрения
            </div>
          )}
        </div>
      </div>

      {/* ФУТЕР */}
      <Footer />
    </div>
  )
}
