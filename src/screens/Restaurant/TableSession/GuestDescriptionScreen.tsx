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

const GENDER_OPTIONS  = ['Муж', 'Жен']
const AGE_OPTIONS     = ['3-5', '6-9', '10-14', '15-18', '19-30', '30-40', '40-50', '50-60', '60+']
const BODY_OPTIONS    = ['Худое', 'Спортивное', 'Полное']
const HAIR_OPTIONS    = ['Темные', 'Светлые', 'Длинные', 'Рыжие', 'Кучерявые', 'Короткие', 'Лысый', 'Хвост', 'Каре', 'Седые']

type GuestData = {
  gender: string | null
  age:    string | null
  body:   string | null
  hair:   string | null
}

const emptyGuest = (): GuestData => ({ gender: null, age: null, body: null, hair: null })

export default function GuestDescriptionScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined

  const [activeGuest, setActiveGuest] = useState<number | 'all'>('all')
  const [guests, setGuests] = useState<GuestData[]>(Array.from({ length: 8 }, emptyGuest))

  const guestColor    = activeGuest !== 'all' ? GUEST_COLORS[activeGuest] : null
  const currentGuest  = activeGuest !== 'all' ? guests[activeGuest] : null

  const updateGuest = (field: keyof GuestData, value: string) => {
    if (activeGuest === 'all') return
    setGuests(prev => {
      const next = [...prev]
      next[activeGuest] = {
        ...next[activeGuest],
        [field]: next[activeGuest][field] === value ? null : value,
      }
      return next
    })
  }

  const goToMenu = () => navigate('/restaurant/menu', { state: { table, guests } })

  return (
    <div className={styles.screen}>

      {/* ── Header 83px ── */}
      <div className={styles.header}>
        <span className={styles.tableDecor}>СТОЛ №{table?.number ?? '—'}</span>
        <button className={styles.backBtn} onClick={() => navigate('/restaurant/tables')}>
          <span className={styles.backArrow} />
        </button>
      </div>

      {/* ── Guest selector bar (top:83px, circles at top:100px) ── */}
      <div className={styles.guestBar}>

        {/* All guests button */}
        <button
          className={`${styles.guestCircle} ${activeGuest === 'all' ? styles.guestCircleActiveAll : ''}`}
          onClick={() => setActiveGuest('all')}
        >
          <img src="/icons/All.png" alt="все" className={styles.allIcon} />
        </button>

        {/* Guests 1–8 */}
        {GUEST_COLORS.map((color, i) => (
          <button
            key={i}
            className={`${styles.guestCircle} ${activeGuest === i ? styles.guestCircleActive : ''}`}
            style={activeGuest === i ? { borderColor: color } : undefined}
            onClick={() => setActiveGuest(i)}
          >
            <span className={styles.guestLabel} style={{ color }}>
              <span className={styles.guestLabelG}>г</span>
              <span className={styles.guestLabelN}>{i + 1}</span>
            </span>
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className={styles.content}>
        {activeGuest === 'all' ? (

          /* Screen 1a — instruction text */
          <div className={styles.instructions}>
            <p className={styles.instructionText}>
              Чтобы не перепутать заказы, кратко опишите каждого гостя.
            </p>
            <p className={styles.instructionText}>&nbsp;</p>
            <ol className={styles.instructionList}>
              <li>Нажмите на кнопку гостя — г1, г2, г3…</li>
              <li>Выберите подходящие признаки: пол, возраст и другие характеристики.</li>
              <li>Если одного признака достаточно для идентификации — сразу переходите в меню.</li>
              <li>Повторите для каждого гостя за столом.</li>
            </ol>
            <p className={styles.instructionText}>&nbsp;</p>
            <p className={styles.instructionText}>
              Чем точнее описание — тем проще будет принять и подать заказ!
            </p>
          </div>

        ) : (

          /* Screen 1b — guest appearance form */
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

      {/* Right-edge green МЕНЮ tab */}
      <div className={styles.menuTab} onClick={goToMenu}>
        <span className={styles.menuTabText}>МЕНЮ</span>
      </div>

      {/* В МЕНЮ button */}
      <div className={styles.footer}>
        <button className={styles.menuBtn} onClick={goToMenu}>В МЕНЮ</button>
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
            style={{
              borderColor: color,
              backgroundColor: selected === opt ? '#fff' : '#d1d3d8',
              color: selected === opt ? color : '#8e9096',
            }}
            onClick={() => onSelect(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}
