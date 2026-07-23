import { supabase } from './supabase'

export type TableZone = 'main' | 'veranda' | 'banquet'
export type TableStatus = 'free' | 'occupied' | 'preparing' | 'resting' | 'bill_requested' | 'call'

export const ZONE_LABELS: Record<TableZone, string> = {
  main: 'основной',
  veranda: 'веранда',
  banquet: 'банкет',
}

export const STATUS_LABELS: Record<TableStatus, string> = {
  free: 'свободен',
  occupied: 'занят',
  preparing: 'готовится',
  resting: 'отдыхают',
  bill_requested: 'ждут счет',
  call: 'вызов',
}

export const STATUS_COLORS: Record<TableStatus, { bg: string; border: string }> = {
  free:           { bg: '#d2d3d8', border: '#8e9096' },
  // «Занят» — гость отсканировал QR, но заказа ещё нет (mark_table_occupied).
  occupied:       { bg: '#227B8F', border: '#185E6E' },
  preparing:      { bg: '#3d6afa', border: '#254ed4' },
  resting:        { bg: '#15b200', border: '#0f8100' },
  bill_requested: { bg: '#ae3bfb', border: '#7c06cc' },
  call:           { bg: '#d30000', border: '#a40000' },
}

export interface TableWithSession {
  id: string
  number: number
  zone: TableZone
  capacity: number
  status: TableStatus
  guestCount: number
  startedAt: string | null
  sessionId: string | null
  waiterId: string | null
  // Тип запрошенного счёта: 'personal' (раздельный) | 'table' (общий) | null.
  // Показывается на карточке только при статусе bill_requested.
  billType: string | null
}

// Сырая строка public.table_sessions, как её отдаёт Realtime в payload.new
export interface TableSessionRow {
  id: string
  table_id: string
  waiter_id: string | null
  status: TableStatus
  guest_count: number
  started_at: string | null
  is_active: boolean
  bill_type: string | null
}

// Точечно применяет одно изменение table_sessions к уже загруженному списку
// столов — без похода в БД. Используется в Realtime-подписке TablesScreen,
// чтобы не дёргать полный loadTables() на каждое событие (см. разбор
// "widcast storm" — сотни событий/сек на весь ресторан не должны означать
// сотни лишних SELECT'ов).
export function applySessionToTables(
  tables: TableWithSession[],
  session: TableSessionRow,
): TableWithSession[] {
  return tables.map(t => {
    if (t.id !== session.table_id) return t

    if (!session.is_active) {
      // Сессия закрылась (стол освободили) — сбрасываем на "свободен"
      return { ...t, status: 'free', guestCount: 0, startedAt: null, sessionId: null, waiterId: null, billType: null }
    }

    return {
      ...t,
      status: session.status,
      guestCount: session.guest_count,
      startedAt: session.started_at,
      sessionId: session.id,
      waiterId: session.waiter_id,
      billType: session.bill_type ?? null,
    }
  })
}

// Плоская строка вью public.tables_with_active_session (миграция 004):
// LEFT JOIN стола с ЕДИНСТВЕННОЙ активной сессией сделан в БД, так что
// сюда больше не долетает история закрытых смен.
const VIEW_COLUMNS = 'id, number, zone, capacity, session_id, session_status, guest_count, started_at, session_waiter_id, session_bill_type'

function mapViewRow(t: any): TableWithSession {
  return {
    id: t.id,
    number: t.number,
    zone: t.zone as TableZone,
    capacity: t.capacity,
    status: (t.session_status ?? 'free') as TableStatus,
    guestCount: t.guest_count ?? 0,
    startedAt: t.started_at ?? null,
    sessionId: t.session_id ?? null,
    waiterId: t.session_waiter_id ?? null,
    billType: t.session_bill_type ?? null,
  }
}

export async function getMyTables(waiterId: string, restaurantId: string): Promise<TableWithSession[]> {
  const today = new Date().toISOString().split('T')[0]

  // Небольшой запрос: какие столы закреплены за официантом в ЭТОМ ресторане.
  const { data: assignments, error: aErr } = await supabase
    .from('waiter_table_assignments')
    .select('table_id, tables!inner ( restaurant_id )')
    .eq('waiter_id', waiterId)
    // Без этого фильтра официант, закреплённый за столами в нескольких
    // ресторанах, видел бы их все вперемешку вместо только текущего.
    .eq('tables.restaurant_id', restaurantId)
    .or(`assigned_date.eq.${today},is_permanent.eq.true`)

  if (aErr) throw aErr

  const tableIds = (assignments ?? []).map((a: any) => a.table_id)
  if (tableIds.length === 0) return []

  const { data, error } = await supabase
    .from('tables_with_active_session')
    .select(VIEW_COLUMNS)
    .in('id', tableIds)
    .order('number')

  if (error) throw error

  return (data as any[]).map(mapViewRow)
}

export async function getAllTables(restaurantId: string): Promise<TableWithSession[]> {
  const { data, error } = await supabase
    .from('tables_with_active_session')
    .select(VIEW_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('table_is_active', true)
    .order('number')

  if (error) throw error

  return (data as any[]).map(mapViewRow)
}

export function formatElapsedTime(startedAt: string | null): string {
  if (!startedAt) return '0 мин'
  const minutes = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)
  if (minutes < 60) return `${minutes} мин`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}
