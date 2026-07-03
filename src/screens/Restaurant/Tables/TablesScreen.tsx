import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getActiveShift } from '../QRScanner/QRScannerScreen'
import { getMyTables, getAllTables, applySessionToTables } from '../../../lib/tables'
import type { TableWithSession, TableSessionRow } from '../../../lib/tables'
import { hasConfirmedShiftToday } from '../../../lib/bookings'
import { supabase, resolveWaiterId } from '../../../lib/supabase'
import TableCard from './TableCard'
import Footer from '../../shared/Footer'
import RestaurantAccessDeniedModal from '../../shared/RestaurantAccessDeniedModal'
import styles from './TablesScreen.module.css'

export default function TablesScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const restaurantId = searchParams.get('restaurant') ?? getActiveShift()?.restaurantId ?? ''

  const [waiterId, setWaiterId] = useState<string | null>(null)
  const [tables, setTables] = useState<TableWithSession[]>([])
  const [tab, setTab] = useState<'my' | 'all'>('my')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // null — ещё проверяем, true/false — результат проверки допуска
  const [authorized, setAuthorized] = useState<boolean | null>(null)

  useEffect(() => {
    resolveWaiterId().then(setWaiterId)
  }, [])

  // Ссылка на ресторан (QR, прямой URL, старый кэш смены) сама по себе
  // ничего не доказывает — прежде чем показать хоть один стол, проверяем,
  // что у официанта есть подтверждённая смена именно здесь и сегодня.
  useEffect(() => {
    if (!waiterId || !restaurantId) return
    let cancelled = false
    hasConfirmedShiftToday(waiterId, restaurantId).then(ok => {
      if (!cancelled) setAuthorized(ok)
    })
    return () => { cancelled = true }
  }, [waiterId, restaurantId])

  const handleAccessDeniedClose = () => {
    localStorage.removeItem('waiter_shift')
    navigate('/restaurant/scan', { replace: true })
  }

  const loadTables = useCallback(async () => {
    if (!restaurantId || !authorized) return
    // "Мои" без определённого официанта не должны молча подменяться на
    // "Все" — иначе оба таба показывают одно и то же под чужим ярлыком,
    // пока waiterId ещё не разрешился (см. resolveWaiterId выше).
    if (tab === 'my' && !waiterId) {
      setLoading(true)
      return
    }
    try {
      setLoading(true)
      setError(null)
      const data = tab === 'my'
        ? await getMyTables(waiterId!, restaurantId)
        : await getAllTables(restaurantId)
      setTables(data)
    } catch (e: any) {
      setError('Не удалось загрузить столы')
    } finally {
      setLoading(false)
    }
  }, [tab, waiterId, restaurantId, authorized])

  useEffect(() => {
    loadTables()
  }, [loadTables])

  // Realtime подписка на изменения статусов — только своего ресторана.
  // INSERT/UPDATE патчат стол точечно, без похода в БД (см. applySessionToTables).
  // DELETE — редкость (сессии обычно не удаляют, а помечают is_active=false),
  // на него безопасно делаем полный рефетч.
  useEffect(() => {
    if (!restaurantId) return

    const filter = `restaurant_id=eq.${restaurantId}`

    const channel = supabase
      .channel(`table_sessions:${restaurantId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'table_sessions',
        filter,
      }, (payload) => {
        setTables(prev => applySessionToTables(prev, payload.new as TableSessionRow))
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'table_sessions',
        filter,
      }, (payload) => {
        setTables(prev => applySessionToTables(prev, payload.new as TableSessionRow))
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'table_sessions',
        filter,
      }, () => {
        loadTables()
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [restaurantId, loadTables])

  const handleTableClick = async (table: TableWithSession) => {
    if (table.status === 'free') {
      navigate(`/restaurant/table/${table.id}/guests`, { state: { table } })
      return
    }
    // Для занятых столов — найти активный заказ и открыть общую корзину
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('table_id', table.id)
      .eq('restaurant_id', restaurantId)
      .not('status', 'eq', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (order?.id) {
      navigate(`/restaurant/table/${table.id}/all-orders`, {
        state: { table, guests: [], orderId: order.id }
      })
    }
  }

  if (authorized === false) {
    return <RestaurantAccessDeniedModal onClose={handleAccessDeniedClose} />
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'my' ? styles.tabActive : ''}`}
            onClick={() => setTab('my')}
          >
            Мои столы
          </button>
          <button
            className={`${styles.tab} ${tab === 'all' ? styles.tabActive : ''}`}
            onClick={() => setTab('all')}
          >
            Все столы
          </button>
        </div>
        <div className={styles.divider} />
      </div>

      <div className={styles.content}>
        {loading && (
          <div className={styles.centered}>
            <div className={styles.spinner} />
          </div>
        )}

        {error && !loading && (
          <div className={styles.centered}>
            <p className={styles.errorText}>{error}</p>
            <button className={styles.retryBtn} onClick={loadTables}>Повторить</button>
          </div>
        )}

        {!loading && !error && tables.length === 0 && (
          <div className={styles.centered}>
            <p className={styles.emptyText}>
              {tab === 'my' ? 'На сегодня столы не назначены' : 'Столы не найдены'}
            </p>
          </div>
        )}

        {!loading && !error && tables.length > 0 && (
          <div className={styles.grid}>
            {tables.map(table => (
              <TableCard key={table.id} table={table} onClick={handleTableClick} />
            ))}
          </div>
        )}
      </div>

      <Footer />
    </div>
  )
}
