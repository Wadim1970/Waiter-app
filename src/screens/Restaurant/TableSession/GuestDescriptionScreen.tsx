import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import styles from './GuestDescriptionScreen.module.css'

const GUEST_COLORS = [
  '#02a826', // г1
  '#ce00b9', // г2
  '#ff9500', // г3
  '#003daf', // г4
  '#6c03ed', // г5
  '#0f929c', // г6
  '#700061', // г7
  '#979200', // г8
]

const GENDER_OPTIONS = ['Мужской', 'Женский']
const AGE_OPTIONS = ['Ребёнок', 'Молодой', 'Средний', 'Старший']
const BODY_OPTIONS = ['Стройный', 'Средний', 'Крупный']
const HAIR_OPTIONS = ['Короткие', 'Средние', 'Длинные', 'Лысый']

type GuestData = {
  gender: string | null
  age: string | null
  body: string | null
  hair: string | null
}

const emptyGuest = (): GuestData => ({ gender: null, age: null, body: null, hair: null })

export default function GuestDescriptionScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined

  const [activeGuest, setActiveGuest] = useState<number | 'all'>('all')
  const [guests, setGuests] = useState<GuestData[]>(
    Array.from({ length: 8 }, emptyGuest)
  )

  const guestColor = activeGuest !== 'all' ? GUEST_COLORS[activeGuest] : null

  const updateGuest = (field: keyof GuestData, value: string) => {
    if (activeGuest === 'all') return
    setGuests(prev => {
      const next = [...prev]
      const current = next[activeGuest]
      next[activeGuest] = {
        ...current,
        [field]: current[field] === value ? null : value,
      }
      return next
    })
  }

  const currentGuest = activeGuest !== 'all' ? guests[activeGuest] : null

  const handleMenu = () => {
    // TODO: navigate to menu screen
    navigate('/restaurant/menu', { state: { table, guests } })
  }

  return (
    <div className={styles.screen}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/restaurant/tables')}>
          ←
        </button>
        <span className={styles.tableLabel}>
          Стол {table?.number ?? '—'}
        </span>
      </div>

      {/* Guest selector */}
      <div className={styles.guestBar}>
        {/* All guests button */}
        <button
          className={`${styles.guestBtn} ${activeGuest === 'all' ? styles.guestBtnActiveAll : ''}`}
          onClick={() => setActiveGuest('all')}
        >
          <img src="/icons/All.png" alt="Все" className={styles.allIcon} />
        </button>

        {/* Guest 1–8 */}
        {GUEST_COLORS.map((color, i) => (
          <button
            key={i}
            className={styles.guestBtn}
            style={activeGuest === i
              ? { backgroundColor: '#fff', borderColor: color, color }
              : { backgroundColor: 'transparent', borderColor: 'transparent', color: '#fff' }
            }
            onClick={() => setActiveGuest(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {activeGuest === 'all' ? (
          /* Пояснительный экран */
          <div className={styles.allView}>
            <p className={styles.hintText}>
              Выберите гостя, чтобы описать его внешность, или нажмите на номер стола, чтобы перейти к заказу
            </p>
          </div>
        ) : (
          /* Форма описания гостя */
          <div className={styles.form}>
            <Section
              icon="/icons/Gender.png"
              label="Пол"
              options={GENDER_OPTIONS}
              selected={currentGuest!.gender}
              color={guestColor!}
              onSelect={v => updateGuest('gender', v)}
            />
            <Section
              icon="/icons/Age.png"
              label="Возраст"
              options={AGE_OPTIONS}
              selected={currentGuest!.age}
              color={guestColor!}
              onSelect={v => updateGuest('age', v)}
            />
            <Section
              icon="/icons/Body_type.png"
              label="Телосложение"
              options={BODY_OPTIONS}
              selected={currentGuest!.body}
              color={guestColor!}
              onSelect={v => updateGuest('body', v)}
            />
            <Section
              icon="/icons/Hair.png"
              label="Волосы"
              options={HAIR_OPTIONS}
              selected={currentGuest!.hair}
              color={guestColor!}
              onSelect={v => updateGuest('hair', v)}
            />
          </div>
        )}
      </div>

      {/* В меню button */}
      <div className={styles.footer}>
        <button className={styles.menuBtn} onClick={handleMenu}>
          В МЕНЮ
        </button>
      </div>
    </div>
  )
}

function Section({
  icon, label, options, selected, color, onSelect,
}: {
  icon: string
  label: string
  options: string[]
  selected: string | null
  color: string
  onSelect: (v: string) => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <img src={icon} alt={label} className={styles.sectionIcon} />
        <span className={styles.sectionLabel}>{label}</span>
      </div>
      <div className={styles.tags}>
        {options.map(opt => (
          <button
            key={opt}
            className={styles.tag}
            style={selected === opt
              ? { borderColor: color, color }
              : undefined
            }
            onClick={() => onSelect(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
