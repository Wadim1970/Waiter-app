import { useState, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import { getOrCreateOrder, saveGuestAttributes } from '../../../lib/orders'
import { saveTableCtx, readTableCtx } from '../../../lib/tableContext'
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
// Повод / тип стола — свойство стола (одно на стол), сильный сигнал для ИИ.
const OCCASION_OPTIONS = ['Один', 'Романтическая встреча', 'Деловая встреча', 'Семья', 'Дружеская компания', 'Праздник']

type GuestData = { gender: string | null; age: string | null; body: string | null; hair: string | null; preferences?: string | null }
const emptyGuest = (): GuestData => ({ gender: null, age: null, body: null, hair: null, preferences: null })

export default function GuestDescriptionScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  // Всегда ровно 8 гостей (г1–г8). Раньше брали пришедший массив КАК ЕСТЬ:
  // если он приходил ПУСТЫМ (стол открыт по заказу из приложения гостя —
  // AllOrdersScreen шлёт guests: []), то `[] ?? fallback` возвращал [], и
  // guests[activeGuest] был undefined → экран падал на currentGuest.gender
  // при добавлении второго гостя. Дополняем недостающие места пустыми.
  const rawGuests = (location.state?.guests ?? []) as GuestData[]
  const initialGuests: GuestData[] = Array.from({ length: 8 }, (_, i) => rawGuests[i] ?? emptyGuest())
  const initialActiveGuest = location.state?.activeGuestIndex ?? 'all'
  const incomingOrderId = location.state?.orderId as string | undefined
  const seatsWithItems = (location.state?.seatsWithItems ?? []) as number[]

  const [activeGuest, setActiveGuest] = useState<number | 'all'>(initialActiveGuest)
  const [guests, setGuests] = useState<GuestData[]>(initialGuests)
  const [loading, setLoading] = useState(false)
  const [occasion, setOccasion] = useState<string | null>(() => readTableCtx(table?.id).occasion)
  const touchStartX = useRef(0)

  // Число гостей за столом = сколько гостей отмечено (хотя бы один признак).
  const partySize = guests.filter(g => g.gender || g.age || g.body).length

  const selectOccasion = (v: string) => {
    const next = occasion === v ? null : v
    setOccasion(next)
    saveTableCtx(table?.id, { occasion: next, partySize })
  }

  const guestColor   = activeGuest !== 'all' ? GUEST_COLORS[activeGuest] : null
  const currentGuest = activeGuest !== 'all' ? (guests[activeGuest] ?? emptyGuest()) : null

  const updateGuest = (field: keyof GuestData, value: string) => {
    if (activeGuest === 'all') return
    setGuests(prev => {
      const next = [...prev]
      next[activeGuest] = { ...next[activeGuest], [field]: next[activeGuest][field] === value ? null : value }
      return next
    })
  }

  // Предпочтения — свободный текст (не тег-переключатель): просто пишем значение.
  const setPreferences = (value: string) => {
    if (activeGuest === 'all') return
    setGuests(prev => {
      const next = [...prev]
      next[activeGuest] = { ...next[activeGuest], preferences: value }
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
      if (activeGuest !== 'all') {
        try { await saveGuestAttributes(orderId, activeGuest + 1, guests[activeGuest]) }
        catch (e) { console.error('saveGuestAttributes error:', e) }
      }
      // Контекст стола (повод + число гостей) — в бэкап и в nav-state для меню.
      saveTableCtx(table.id, { occasion, partySize })
      navigate('/restaurant/menu', {
        state: { table, guests, orderId, activeGuestIndex: guestIndex, occasion, partySize }
      })
    } catch (err) {
      console.error('goToMenu error:', err)
      const guestIndex = activeGuest === 'all' ? 0 : activeGuest
      navigate('/restaurant/menu', {
        state: { table, guests, orderId: incomingOrderId ?? null, activeGuestIndex: guestIndex, occasion, partySize }
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
    <div
      className={styles.screen}
      onTouchStart={e => { touchStartX.current = e.touches[0].clientX }}
      onTouchEnd={e => { if (e.changedTouches[0].clientX - touchStartX.current < -80) goToMenu() }}
    >

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
            const hasCart = seatsWithItems.includes(i + 1)
            return (
              <button
                key={i}
                className={`${styles.guestCircle} ${isActive ? styles.guestCircleActive : ''}`}
                style={(isActive || hasCart) ? { borderColor: color } : undefined}
                onClick={() => {
                  if (hasCart && incomingOrderId) {
                    navigate(`/restaurant/table/${table?.id ?? ''}/order`, {
                      state: { table, guests, orderId: incomingOrderId, activeGuestIndex: i, noAnimation: true }
                    })
                  } else {
                    setActiveGuest(i)
                  }
                }}
              >
                <span
                  className={styles.guestLabel}
                  style={{ color: (isActive || hasCart) ? color : '#8e9096' }}
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
              <li>Выберите признаки: пол, возраст, телосложение — и укажите повод / тип стола.</li>
              <li>Повод задаётся один раз и действует на весь стол.</li>
              <li>Повторите описание для каждого гостя.</li>
            </ol>
            <p className={styles.instructionText}>&nbsp;</p>
            <p className={styles.instructionText}>Чем точнее описание — тем проще будет принять и подать заказ!</p>
          </div>

        ) : (

          <div className={styles.form}>
            <Section icon="/icons/Gender.png"    label="Пол"           options={GENDER_OPTIONS} selected={currentGuest!.gender} color={guestColor!} onSelect={v => updateGuest('gender', v)} />
            <Section icon="/icons/Age.png"       label="Возраст"       options={AGE_OPTIONS}    selected={currentGuest!.age}    color={guestColor!} onSelect={v => updateGuest('age', v)} />
            <Section icon="/icons/Body_type.png" label="Телосложение"  options={BODY_OPTIONS}   selected={currentGuest!.body}   color={guestColor!} onSelect={v => updateGuest('body', v)} />
            {/* Предпочтения / ограничения — свободный текст на гостя. Уходит в
                ИИ-помощника меню: такие блюда не предлагаются («без чеснока»). */}
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionLabel}>Предпочтения / ограничения</span>
              </div>
              <textarea
                className={styles.prefInput}
                style={{ borderColor: guestColor! }}
                rows={2}
                value={currentGuest!.preferences ?? ''}
                onChange={e => setPreferences(e.target.value)}
                placeholder="без чеснока, аллергия на орехи, не любит острое…"
              />
            </div>
            {/* Повод / тип стола — одно на стол (держится до закрытия счёта), но
                задаётся прямо здесь, на карточке гостя, где раньше были «Волосы». */}
            <Section label="Повод / тип стола" options={OCCASION_OPTIONS} selected={occasion} color="#0B3563" onSelect={selectOccasion} />
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
  icon?: string; label: string; options: string[]
  selected: string | null; color: string; onSelect: (v: string) => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        {icon && <img src={icon} alt={label} className={styles.sectionIcon} />}
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
