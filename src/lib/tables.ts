import { supabase } from './supabase'

export type TableZone = 'main' | 'veranda' | 'banquet'
export type TableStatus = 'free' | 'preparing' | 'resting' | 'bill_requested' | 'call'

export const ZONE_LABELS: Record<TableZone, string> = {
  main: 'основной',
  veranda: 'веранда',
  banquet: 'банкет',
}

export const STATUS_LABELS: Record<TableStatus, string> = {
  free: 'свободен',
  preparing: 'готовится',
  resting: 'отдыхают',
  bill_requested: 'ждут счет',
  call: 'вызов',
}

export const STATUS_COLORS: Record<TableStatus, { bg: string; border: string }> = {
  free:           { bg: '#d2d3d8', border: '#8e9096' },
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
}

export async function getMyTables(waiterId: string, restaurantId: string): Promise<TableWithSession[]> {
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('waiter_table_assignments')
    .select(`
      table_id,
      tables!inner (
        id, number, zone, capacity,
        table_sessions (
          id, status, guest_count, started_at, waiter_id, is_active
        )
      )
    `)
    .eq('waiter_id', waiterId)
    .or(`assigned_date.eq.${today},is_permanent.eq.true`)

  if (error) throw error

  return mapTablesToView(data)
}

export async function getAllTables(restaurantId: string): Promise<TableWithSession[]> {
  const { data, error } = await supabase
    .from('tables')
    .select(`
      id, number, zone, capacity,
      table_sessions (
        id, status, guest_count, started_at, waiter_id, is_active
      )
    `)
    .eq('restaurant_id', restaurantId)
    .eq('is_active', true)
    .order('number')

  if (error) throw error

  return data.map((t: any) => {
    const session = t.table_sessions?.find((s: any) => s.is_active) ?? null
    return {
      id: t.id,
      number: t.number,
      zone: t.zone as TableZone,
      capacity: t.capacity,
      status: (session?.status ?? 'free') as TableStatus,
      guestCount: session?.guest_count ?? 0,
      startedAt: session?.started_at ?? null,
      sessionId: session?.id ?? null,
      waiterId: session?.waiter_id ?? null,
    }
  })
}

function mapTablesToView(data: any[]): TableWithSession[] {
  return data.map((row: any) => {
    const t = row.tables
    const session = t.table_sessions?.find((s: any) => s.is_active) ?? null
    return {
      id: t.id,
      number: t.number,
      zone: t.zone as TableZone,
      capacity: t.capacity,
      status: (session?.status ?? 'free') as TableStatus,
      guestCount: session?.guest_count ?? 0,
      startedAt: session?.started_at ?? null,
      sessionId: session?.id ?? null,
      waiterId: session?.waiter_id ?? null,
    }
  })
}

export function formatElapsedTime(startedAt: string | null): string {
  if (!startedAt) return '0 мин'
  const minutes = Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000)
  if (minutes < 60) return `${minutes} мин`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`
}
