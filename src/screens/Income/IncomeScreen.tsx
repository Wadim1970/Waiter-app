import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, getWaiterId } from '../../lib/supabase'
import Footer from '../shared/Footer'
import styles from './IncomeScreen.module.css'

type Tab = 'week' | 'month' | 'year'

type ShiftRecord = {
  id: string
  shift_date: string
  checked_in_at: string | null
  checked_out_at: string | null
  tips_amount: number
  restaurant_name: string
  pay_amount: number
}

type BarData = {
  label: string
  value: number
  isCurrent: boolean
}

function formatAmount(n: number): string {
  return n.toLocaleString('ru-RU')
}

function hoursWorked(inAt: string | null, outAt: string | null): number {
  if (!inAt || !outAt) return 0
  return Math.round((new Date(outAt).getTime() - new Date(inAt).getTime()) / 3600000)
}

function formatShiftDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'сегодня'
  if (date.toDateString() === yesterday.toDateString()) return 'вчера'
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function getWeekBars(shifts: ShiftRecord[]): BarData[] {
  const now = new Date()
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
  monday.setHours(0, 0, 0, 0)

  const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
  return days.map((label, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    const dateStr = d.toISOString().slice(0, 10)
    const value = shifts
      .filter(s => s.shift_date === dateStr)
      .reduce((sum, s) => sum + s.pay_amount + s.tips_amount, 0)
    const isCurrent = d.toDateString() === now.toDateString()
    return { label, value, isCurrent }
  })
}

function getMonthBars(shifts: ShiftRecord[]): BarData[] {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const value = shifts
      .filter(s => s.shift_date === dateStr)
      .reduce((sum, s) => sum + s.pay_amount + s.tips_amount, 0)
    return { label: String(day), value, isCurrent: day === now.getDate() }
  })
}

function getYearBars(shifts: ShiftRecord[]): BarData[] {
  const now = new Date()
  const year = now.getFullYear()
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  return months.map((label, i) => {
    const value = shifts
      .filter(s => {
        const d = new Date(s.shift_date)
        return d.getFullYear() === year && d.getMonth() === i
      })
      .reduce((sum, s) => sum + s.pay_amount + s.tips_amount, 0)
    return { label, value, isCurrent: i === now.getMonth() }
  })
}

function getPeriodRange(tab: Tab): { from: string; to: string } {
  const now = new Date()
  if (tab === 'week') {
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) }
  }
  if (tab === 'month') {
    const year = now.getFullYear()
    const month = now.getMonth()
    const last = new Date(year, month + 1, 0)
    return {
      from: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      to: last.toISOString().slice(0, 10),
    }
  }
  return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` }
}

function getPrevPeriodRange(tab: Tab): { from: string; to: string } {
  const now = new Date()
  if (tab === 'week') {
    const day = now.getDay()
    const monday = new Date(now)
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) - 7)
    monday.setHours(0, 0, 0, 0)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) }
  }
  if (tab === 'month') {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const last = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: d.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) }
  }
  return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` }
}

const BAR_MAX_HEIGHT = 86

export default function IncomeScreen() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('week')
  const [shifts, setShifts] = useState<ShiftRecord[]>([])
  const [prevTotal, setPrevTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const waiterId = getWaiterId()
    if (!waiterId) { navigate('/'); return }

    const { from, to } = getPeriodRange(tab)
    const { from: pFrom, to: pTo } = getPrevPeriodRange(tab)

    setLoading(true)
    Promise.all([
      supabase
        .from('staff_shifts')
        .select('id, shift_date, checked_in_at, checked_out_at, tips_amount, job_id, restaurant_id')
        .eq('waiter_id', waiterId)
        .gte('shift_date', from)
        .lte('shift_date', to),
      supabase
        .from('staff_shifts')
        .select('job_id, tips_amount')
        .eq('waiter_id', waiterId)
        .gte('shift_date', pFrom)
        .lte('shift_date', pTo),
    ]).then(async ([cur, prev]) => {
      const curShifts = cur.data ?? []
      const prevShifts = prev.data ?? []

      // Fetch restaurant names and pay amounts
      const restaurantIds = [...new Set(curShifts.map(s => s.restaurant_id).filter(Boolean))]
      const jobIds = [...new Set(curShifts.map(s => s.job_id).filter(Boolean))]
      const prevJobIds = [...new Set(prevShifts.map(s => s.job_id).filter(Boolean))]

      const [{ data: restaurants }, { data: jobs }, { data: prevJobs }] = await Promise.all([
        restaurantIds.length
          ? supabase.from('restaurants').select('"restaurantId", name').in('"restaurantId"', restaurantIds)
          : Promise.resolve({ data: [] as any[] }),
        jobIds.length
          ? supabase.from('jobs').select('id, pay_amount').in('id', jobIds)
          : Promise.resolve({ data: [] as any[] }),
        prevJobIds.length
          ? supabase.from('jobs').select('id, pay_amount').in('id', prevJobIds)
          : Promise.resolve({ data: [] as any[] }),
      ])

      const restaurantMap = Object.fromEntries((restaurants ?? []).map((r: any) => [r.restaurantId, r.name]))
      const jobMap = Object.fromEntries((jobs ?? []).map((j: any) => [j.id, j.pay_amount ?? 0]))
      const prevJobMap = Object.fromEntries((prevJobs ?? []).map((j: any) => [j.id, j.pay_amount ?? 0]))

      const records: ShiftRecord[] = curShifts.map(s => ({
        id: s.id,
        shift_date: s.shift_date,
        checked_in_at: s.checked_in_at,
        checked_out_at: s.checked_out_at,
        tips_amount: s.tips_amount ?? 0,
        restaurant_name: restaurantMap[s.restaurant_id] ?? '—',
        pay_amount: jobMap[s.job_id] ?? 0,
      }))

      const prevTotalCalc = prevShifts.reduce(
        (sum, s) => sum + (prevJobMap[s.job_id] ?? 0) + (s.tips_amount ?? 0), 0
      )

      setShifts(records)
      setPrevTotal(prevTotalCalc)
      setLoading(false)
    })
  }, [tab, navigate])

  const totalPay = shifts.reduce((s, r) => s + r.pay_amount, 0)
  const totalTips = shifts.reduce((s, r) => s + r.tips_amount, 0)
  const total = totalPay + totalTips
  const growth = prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0

  const bars: BarData[] = tab === 'week'
    ? getWeekBars(shifts)
    : tab === 'month'
    ? getMonthBars(shifts)
    : getYearBars(shifts)

  const maxVal = Math.max(...bars.map(b => b.value), 1)
  const maxIndex = bars.findIndex(b => b.value === maxVal && maxVal > 0)

  const periodLabel = tab === 'week' ? 'за неделю' : tab === 'month' ? 'за месяц' : 'за год'

  const tabLabels: { key: Tab; label: string }[] = [
    { key: 'week', label: 'Неделя' },
    { key: 'month', label: 'Месяц' },
    { key: 'year', label: 'Год' },
  ]

  const showLabels = tab === 'year'

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <span className={styles.title}>МОЙ ДОХОД</span>
      </div>

      {/* Tab switcher */}
      <div className={styles.tabSwitcher}>
        <div className={styles.tabTrack}>
          {tabLabels.map(t => (
            <button
              key={t.key}
              className={`${styles.tabBtn} ${tab === t.key ? styles.tabBtnActive : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary card */}
      <div className={styles.card}>
        <span className={styles.cardLabel}>Всего {periodLabel}</span>
        <div className={styles.cardTotalRow}>
          <span className={styles.cardTotal}>{formatAmount(total)} ₽</span>
          {growth !== 0 && (
            <span className={`${styles.cardGrowth} ${growth < 0 ? styles.cardGrowthNeg : ''}`}>
              {growth > 0 ? '+' : ''}{growth}%
            </span>
          )}
        </div>
        <div className={styles.cardDivider} />
        <div className={styles.cardBottomRow}>
          <div className={styles.cardSection}>
            <span className={styles.cardSectionLabel}>выплаты</span>
            <span className={styles.cardSectionVal}>{formatAmount(totalPay)} ₽</span>
          </div>
          <div className={styles.cardSection}>
            <span className={styles.cardSectionLabel}>чаевые</span>
            <span className={styles.cardSectionVal}>{formatAmount(totalTips)} ₽</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className={styles.chartWrap}>
        <div className={`${styles.chartBars} ${tab === 'month' ? styles.chartBarsMonth : tab === 'year' ? styles.chartBarsYear : ''}`}>
          {bars.map((bar, i) => {
            const height = maxVal > 0 ? Math.round((bar.value / maxVal) * BAR_MAX_HEIGHT) : 0
            return (
              <div key={i} className={styles.barCol}>
                <div
                  className={`${styles.bar} ${i === maxIndex ? styles.barActive : ''}`}
                  style={{ height: `${Math.max(height, 2)}px` }}
                />
                {showLabels && (
                  <span className={styles.barLabel}>{bar.label}</span>
                )}
              </div>
            )
          })}
        </div>
        {tab === 'week' && (
          <div className={styles.weekLabels}>
            {bars.map((bar, i) => (
              <span key={i} className={styles.weekLabel}>{bar.label}</span>
            ))}
          </div>
        )}
      </div>

      {/* Shift list */}
      <div className={styles.shiftList}>
        {loading && <p className={styles.empty}>Загрузка...</p>}
        {!loading && shifts.length === 0 && (
          <p className={styles.empty}>Нет смен за этот период</p>
        )}
        {shifts.map(s => {
          const hours = hoursWorked(s.checked_in_at, s.checked_out_at)
          const dateLabel = formatShiftDate(s.shift_date)
          return (
            <div key={s.id} className={styles.shiftCard}>
              <div className={styles.shiftLeft}>
                <span className={styles.shiftRestaurant}>{s.restaurant_name}</span>
                <span className={styles.shiftMeta}>
                  {dateLabel}{hours > 0 ? ` - ${hours} часов` : ''}
                </span>
              </div>
              <div className={styles.shiftRight}>
                <span className={styles.shiftPay}>+{formatAmount(s.pay_amount)}</span>
                <span className={styles.shiftTips}>чай: {formatAmount(s.tips_amount)}</span>
              </div>
            </div>
          )
        })}
      </div>

      <Footer />
    </div>
  )
}
