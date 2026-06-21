import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getActiveShift } from '../QRScanner/QRScannerScreen'
import { getMyTables, getAllTables } from '../../../lib/tables'
import type { TableWithSession } from '../../../lib/tables'
import { supabase } from '../../../lib/supabase'
import TableCard from './TableCard'
import Footer from '../../shared/Footer'
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

  useEffect(() => {
    const id = localStorage.getItem('waiter_device_id')
    setWaiterId(id)
  }, [])


  const loadTables = useCallback(async () => {
    if (!restaurantId) return
    try {
      setLoading(true)
      setError(null)
      const data = tab === 'my' && waiterId
        ? await getMyTables(waiterId, restaurantId)
        : await getAllTables(restaurantId)
      setTables(data)
    } catch (e: any) {
      setError('Не удалось загрузить столы')
    } finally {
      setLoading(false)
    }
  }, [tab, waiterId, restaurantId])

  useEffect(() => {
    loadTables()
  }, [loadTables])

  // Realtime подписка на изменения статусов
  useEffect(() => {
    if (!restaurantId) return

    const channel = supabase
      .channel('table_sessions_changes')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'table_sessions',
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
