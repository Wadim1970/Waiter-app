import { supabaseWaiter, supabaseRestaurants } from './supabase'

// ══════════════════════════════════════════════════════════════
// ТИПЫ
// ═══════════════════════════════════════════════════════════════

export interface Booking {
  id: string
  job_id: string
  worker_id: string
  status: 'applied' | 'approved' | 'confirmed' | 'rejected' | 'cancelled'
  created_at: string
  updated_at: string
  job?: Job
}

export interface Job {
  id: string
  restaurant_id: string
  shift_date: string
  start_time: string
  end_time: string
  slots_total: number
  slots_available: number
  pay_amount: number
  dress_code: string
  tips_distribution: string
  nutrition: string
  required_documents: string
  responsibility_zone: string
  duties: string
  required_technologies: string
  restaurant?: Restaurant
}

export interface Restaurant {
  restaurantId: string
  name: string
  address: string
  rating_staff: number
  latitude: number
  longitude: number
}

export interface ShiftWithDetails extends Booking {
  job: Job & {
    restaurant: Restaurant
  }
}

// ═══════════════════════════════════════════════════════════════
// 1️⃣ ОТКЛИКНУТЬСЯ НА ВАКАНСИЮ
// ═══════════��═══════════════════════════════════════════════════

export async function applyForJob(waiterId: string, jobId: string) {
  try {
    // Проверяем что вакансия ещё доступна
    const { data: job, error: jobError } = await supabaseRestaurants
      .from('jobs')
      .select('slots_available')
      .eq('id', jobId)
      .single()

    if (jobError) throw jobError

    if (!job || job.slots_available <= 0) {
      throw new Error('К сожалению, эта вакансия уже недоступна')
    }

    // Создаём бронирование через функцию БД (решает проблему RLS + app.current_user_id)
    const { data, error } = await supabaseWaiter
      .rpc('create_booking', {
        p_worker_id: waiterId,
        p_job_id: jobId
      })

    if (error) {
      if (error.code === '23505') {
        throw new Error('Вы уже откликнулись на эту вакансию')
      }
      throw error
    }

    return { data, error: null }
  } catch (error: any) {
    console.error('Ошибка при отклике на вакансию:', error)
    return { data: null, error }
  }
}

// ═══════════════════════════════════════════════════════════════
// 2️⃣ ПОЛУЧИТЬ МОИ СМЕНЫ ПО СТАТУСУ
// ═══════════════════════════════════════════════════════════════

export async function getMyShifts(
  waiterId: string,
  status: 'applied' | 'approved' | 'confirmed'
): Promise<{ data: ShiftWithDetails[] | null; error: any }> {
  try {
    // bookings и jobs/restaurants исторически читались через два разных
    // клиента ("База 1"/"База 2"), но это один и тот же проект Supabase —
    // PostgREST сам строит вложенный JOIN по существующим FK
    // (bookings.job_id -> jobs.id, jobs.restaurant_id -> restaurants),
    // так что один запрос заменяет прежние два round-trip'а с join'ом в JS.
    const { data, error } = await supabaseWaiter
      .from('bookings')
      .select(`
        *,
        job:jobs ( *, restaurant:restaurants(*) )
      `)
      .eq('worker_id', waiterId)
      .eq('status', status)
      .order('created_at', { ascending: false })

    if (error) throw error

    const shiftsWithDetails = (data ?? [])
      .filter((b: any) => b.job)
      .map((b: any) => b as ShiftWithDetails)

    return { data: shiftsWithDetails, error: null }
  } catch (error: any) {
    console.error('Ошибка получения смен:', error)
    return { data: null, error }
  }
}

// ══════════════════��════════════════════════════════════════════
// 3️⃣ ПОДТВЕРДИТЬ ВЫХОД НА СМЕНУ (МЭТЧ!)
// ═══════════════════════════════════════════════════════════════

export async function confirmShift(bookingId: string, waiterId: string) {
  try {
    const { data, error } = await supabaseWaiter
      .from('bookings')
      .update({
        status: 'confirmed',
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)
      .select()
      .single()

    if (error) throw error

    // Триггер автоматически уменьшит slots_available
    console.log('✅ Смена подтверждена:', data)

    return { data, error: null }
  } catch (error: any) {
    console.error('Ошибка подтверждения смены:', error)
    return { data: null, error }
  }
}
// ═══════════════════════════════════════════════════════════════
// 4️⃣ ОТМЕНИТЬ ЗАЯВКУ (ДО ПОДТВЕРЖДЕНИЯ)
// ═══════════════════════════════════════════════════════════════

export async function cancelBooking(bookingId: string, waiterId: string) {
  try {
    // Проверяем что статус не 'confirmed'
    const { data: booking, error: checkError } = await supabaseWaiter
      .from('bookings')
      .select('status')
      .eq('id', bookingId)
      .single()

    if (checkError) throw checkError

    if (booking?.status === 'confirmed') {
      throw new Error('Нельзя отменить подтверждённую смену. Обратитесь в поддержку.')
    }

    // Отменяем
    const { error } = await supabaseWaiter
      .from('bookings')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId)

    if (error) throw error

    return { data: { id: bookingId, status: 'cancelled' }, error: null }
  } catch (error: any) {
    console.error('Ошибка отмены бронирования:', error)
    return { data: null, error }
  }
}

// ═══════════════════════════════════════════════════════════════
// 5️⃣ ПРОВЕРИТЬ ЕСТЬ ЛИ УЖЕ ЗАЯВКА НА ВАКАНСИЮ
// ═══════════════════════════════════════════════════════════════

export async function hasAppliedForJob(waiterId: string, jobId: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseWaiter
      .from('bookings')
      .select('id')
      .eq('worker_id', waiterId)
      .eq('job_id', jobId)
      .in('status', ['applied', 'approved', 'confirmed'])
      .maybeSingle()

    if (error) throw error

    return !!data
  } catch (error) {
    console.error('Ошибка проверки заявки:', error)
    return false
  }
}

// ═══════════════════════════════════════════════════════════════
// 6️⃣ ПОЛУЧИТЬ КОЛИЧЕСТВО СМЕН ПО СТАТУСАМ (ДЛЯ БЕЙДЖЕЙ)
// ═══════════════════════════════════════════════════════════════

export async function getShiftCounts(waiterId: string) {
  try {
    const { data, error } = await supabaseWaiter
      .from('bookings')
      .select('status')
      .eq('worker_id', waiterId)
      .in('status', ['applied', 'approved', 'confirmed'])

    if (error) throw error

    const counts = {
      applied: 0,
      approved: 0,
      confirmed: 0
    }

    data?.forEach(booking => {
      if (booking.status in counts) {
        counts[booking.status as keyof typeof counts]++
      }
    })

    return { data: counts, error: null }
  } catch (error: any) {
    console.error('Ошибка получения счётчиков:', error)
    return { data: null, error }
  }
}
