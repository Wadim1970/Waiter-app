import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import { getOrCreateOrder } from '../../../lib/orders'
import { getActiveShift } from '../QRScanner/QRScannerScreen'
import styles from './GuestDescriptionScreen.module.css'

const GUEST_COLORS = [
  '#02a826',
  '#ce00b9',
  '#ff9500',
  '#003daf',
  '#6c03ed',
  '#0f929c',
  '#700061',
  '#979200',
]

const GENDER_OPTIONS = ['Муж', 'Жен']
const AGE_OPTIONS    = ['3-5', '6-9', '10-14', '15-18', '19-30', '30-40', '40-50', '50-60', '60+']
const BODY_OPTIONS   = ['Худое', 'Спортивное', 'Полное']
const HAIR_OPTIONS   = ['Темные', 'Светлые', 'Длинные', 'Рыжие', 'Кучерявые', 'Короткие', 'Лысый', 'Хвост', 'Каре', 'Седые']

type GuestData = { gender: string | null; age: string | null; body: string | null; hair: string | null }
const emptyGuest = (): GuestData => ({ gender: null, age: null, body: null, hair: null })

export default function GuestDescriptionScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  const initialGuests = (location.state?.guests ?? Array.from({ length: 8 }, emptyGuest)) as GuestData[]
  const initialActiveGuest = location.state?.activeGuestIndex ?? 'all'
  const incomingOrderId = location.state?.orderId as string | undefined

  const [activeGuest, setActiveGuest] = useState<number | 'all'>(initialActiveGuest)
  const [guests, setGuests] = useState<GuestData[]>(initialGuests)
  const [loading, setLoading] = useState(false)

  const guestColor   = activeGuest !== 'all' ? GUEST_COLORS[activeGuest] : null
  const currentGuest = activeGuest !== 'all' ? guests[activeGuest] : null

  const updateGuest = (field: keyof GuestData, value: string) => {
    if (activeGuest === 'all') return
    setGuests(prev => {
      const next = [...prev]
      next[activeGuest] = { ...next[activeGuest], [field]: next[activeGuest][field] === value ? null : value }
      return next
    })
  }

  const goToMenu = async () => {
    if (!table) return
    setLoading(true)
    try {
      const restaurantId = getActiveShift()?.restaurantId ?? ''
      const orderId = incomingOrderId ?? await getOrCreateOrder(table.id, table.number, restaurantId)
      const guestIndex = activeGuest === 'all' ? 0 : activeGuest
      navigate('/restaurant/menu', {
        state: { table, guests, orderId, activeGuestIndex: guestIndex }
      })
    } catch (err) {
      console.error('goToMenu error:', err)
      // Navigate anyway without orderId so the app doesn't freeze
      const guestIndex = activeGuest === 'all' ? 0 : activeGuest
      navigate('/restaurant/menu', {
        state: { table, guests, orderId: incomingOrderId ?? null, activeGuestIndex: guestIndex }
      })
    } finally {
      setLoading(false)
    }
  }

  const handleBack = () => {
    if (incomingOrderId) {
      navigate(`/restaurant/table/${table?.id ?? ''}/order`, {
        state: { table, guests, orderId: incomingOrderId, activeGuestIndex: 0 }
      })
    } else {
      navigate('/restaurant/tables')
    }
  }

  return (
    <div className={styles.screen}>

      {/* ── Fixed white zone (154px): header + guest bar ── */}
      <div className={styles.headerZone}>

        {/* Header 83px */}
        <div className={styles.header}>
          <span className={styles.tableDecor}>СТОЛ №{table?.number ?? '—'}</span>
          <button className={styles.backBtn} onClick={handleBack}>
            <svg width="22" height="16" viewBox="0 0 22 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 8H1M1 8L8 1M1 8L8 15" stroke="#717f98" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Guest bar 70px */}
        <div className={styles.guestBar}>
          <button
            className={`${styles.guestCircle} ${activeGuest === 'all' ? styles.guestCircleActiveAll : ''}`}
            onClick={() => setActiveGuest('all')}
          >
            <img src="/icons/All.png" alt="все" className={styles.allIcon} />
          </button>

          {GUEST_COLORS.map((color, i) => {
            const isActive = activeGuest === i
            return (
              <button
                key={i}
                className={`${styles.guestCircle} ${isActive ? styles.guestCircleActive : ''}`}
                style={isActive ? { borderColor: color } : undefined}
                onClick={() => setActiveGuest(i)}
              >
                <span
                  className={styles.guestLabel}
                  style={{ color: isActive ? color : '#8e9096' }}
                >
                  <span className={styles.guestLabelG}>г</span>
                  <span className={styles.guestLabelN}>{i + 1}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className={styles.content}>
        {activeGuest === 'all' ? (

          <div className={styles.instructions}>
            <p className={styles.instructionText}>Чтобы не перепутать заказы, кратко опишите каждого гостя.</p>
            <p className={styles.instructionText}>&nbsp;</p>
            <ol className={styles.instructionList}>
              <li>Нажмите на кнопку гостя — г1, г2, г3…</li>
              <li>Выберите подходящие признаки: пол, возраст и другие характеристики.</li>
              <li>Если одного признака достаточно для идентификации — сразу переходите в меню.</li>
              <li>Повторите для каждого гостя за столом.</li>
            </ol>
            <p className={styles.instructionText}>&nbsp;</p>
            <p className={styles.instructionText}>Чем точнее описание — тем проще будет принять и подать заказ!</p>
          </div>

        ) : (

          <div className={styles.form}>
            <Section icon="/icons/Gender.png"    label="Пол"           options={GENDER_OPTIONS} selected={currentGuest!.gender} color={guestColor!} onSelect={v => updateGuest('gender', v)} />
            <Section icon="/icons/Age.png"       label="Возраст"       options={AGE_OPTIONS}    selected={currentGuest!.age}    color={guestColor!} onSelect={v => updateGuest('age', v)} />
            <Section icon="/icons/Body_type.png" label="Телосложение"  options={BODY_OPTIONS}   selected={currentGuest!.body}   color={guestColor!} onSelect={v => updateGuest('body', v)} />
            <Section icon="/icons/Hair.png"      label="Волосы"        options={HAIR_OPTIONS}   selected={currentGuest!.hair}   color={guestColor!} onSelect={v => updateGuest('hair', v)} />
          </div>
        )}
      </div>

      {/* Right-edge МЕНЮ tab */}
      <div className={styles.menuTab} onClick={goToMenu}>
        <span className={styles.menuTabText}>МЕНЮ</span>
      </div>

      {/* В МЕНЮ button */}
      <div className={styles.footer}>
        <button className={styles.menuBtn} onClick={goToMenu} disabled={loading}>
          {loading ? '...' : 'В МЕНЮ'}
        </button>
      </div>
    </div>
  )
}

function Section({ icon, label, options, selected, color, onSelect }: {
  icon: string; label: string; options: string[]
  selected: string | null; color: string; onSelect: (v: string) => void
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
