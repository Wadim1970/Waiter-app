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
// ═══════════════════════════════════════════════════════════════

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
      // bookings никогда не удаляются — за годы работы официанта тут может
      // накопиться сотни записей на статус. Экран показывает недавние смены,
      // а не полную историю с начала времён.
      .limit(50)

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

// ═══════════════════════════════════════════════════════════════
// 3️⃣ ПОДТВЕРДИТЬ ВЫХОД НА СМЕНУ (МЭТЧ!)
// ═══════════════════════════════════════════════════════════════

// RPC вместо прямого update — заодно каскадно отменяет ОСТАЛЬНЫЕ брони
// этого официанта (applied/approved) на ТУ ЖЕ дату смены: нельзя выйти
// в двух местах одновременно. Триггер на slots_available срабатывает
// как и раньше — RPC делает тот же UPDATE bookings, просто изнутри.
export async function confirmShift(bookingId: string, waiterId: string) {
  try {
    const { error } = await supabaseWaiter.rpc('confirm_shift', {
      p_booking_id: bookingId,
      p_worker_id: waiterId,
    })

    if (error) throw error

    console.log('✅ Смена подтверждена')

    return { data: { id: bookingId, status: 'confirmed' }, error: null }
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
    // Считаем прямо в БД (GROUP BY), а не гоняем по сети все bookings
    // официанта ради подсчёта 3 чисел для бейджей — bookings не удаляются
    // и за долгую карьеру это могли быть сотни строк на один рендер.
    const { data, error } = await supabaseWaiter.rpc('get_shift_counts', {
      p_worker_id: waiterId,
    })

    if (error) throw error

    const counts = {
      applied: 0,
      approved: 0,
      confirmed: 0
    }

    ;(data ?? []).forEach((row: { status: string; cnt: number }) => {
      if (row.status in counts) {
        counts[row.status as keyof typeof counts] = Number(row.cnt)
      }
    })

    return { data: counts, error: null }
  } catch (error: any) {
    console.error('Ошибка получения счётчиков:', error)
    return { data: null, error }
  }
}

// ═══════════════════════════════════════════════════════════════
// 8️⃣ NOTIFICATION BADGE: НЕПРОСМОТРЕННЫЕ ОДОБРЕНИЯ
// ═══════════════════════════════════════════════════════════════
// seen_at сбрасывается в NULL на самой БД при переходе брони в 'approved'
// (см. миграцию) — здесь просто читаем счётчик и отмечаем просмотренным.

export async function getUnseenApprovedCount(waiterId: string): Promise<number> {
  try {
    const { data, error } = await supabaseWaiter.rpc('get_unseen_approved_count', {
      p_worker_id: waiterId,
    })
    if (error) throw error
    return Number(data ?? 0)
  } catch (error) {
    console.error('Ошибка получения счётчика одобрений:', error)
    return 0
  }
}

export async function markApprovedSeen(waiterId: string): Promise<void> {
  try {
    const { error } = await supabaseWaiter.rpc('mark_approved_seen', {
      p_worker_id: waiterId,
    })
    if (error) throw error
  } catch (error) {
    console.error('Ошибка отметки одобрений просмотренными:', error)
  }
}

// ═══════════════════════════════════════════════════════════════
// 7️⃣ ДОПУЩЕН ЛИ ОФИЦИАНТ К СМЕНЕ В ЭТОМ РЕСТОРАНЕ СЕГОДНЯ
// ═══════════════════════════════════════════════════════════════
// Используется и при сканировании QR, и при открытии экрана столов —
// одной ссылки/старого кэша смены недостаточно для доступа к чужому
// ресторану, нужна реально подтверждённая смена именно там и сегодня.

export async function hasConfirmedShiftToday(waiterId: string, restaurantId: string): Promise<boolean> {
  try {
    const today = new Date().toISOString().split('T')[0]
    const { data, error } = await supabaseWaiter
      .from('bookings')
      .select('id, jobs!inner(restaurant_id, shift_date)')
      .eq('worker_id', waiterId)
      .eq('status', 'confirmed')
      .eq('jobs.restaurant_id', restaurantId)
      .eq('jobs.shift_date', today)
      .limit(1)
      .maybeSingle()

    if (error) throw error
    return !!data
  } catch (error) {
    console.error('Ошибка проверки допуска к смене:', error)
    return false
  }
}
