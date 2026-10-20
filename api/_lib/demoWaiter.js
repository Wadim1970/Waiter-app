// Демо-вход в приложение официанта по коду (кнопка «Вход» → 4 цифры).
//
// Рестораторы, которым показываем продукт, вводят общий код и сразу попадают
// в «Сыроварню» (наш тестовый ресторан) на экран своих столов. Под кодом —
// отдельный аккаунт демо-официанта (не чей-то личный): вход по телефону-
// заглушке и служебному паролю из окружения сервера. Все, кто ввёл код,
// работают под одним этим официантом — видят одни столы, получают одни вызовы.
//
// Здесь же — подготовка, без которой экран столов пуст или закрыт:
//   • подтверждённая смена в ресторане на сегодня (jobs + bookings);
//   • столы, закреплённые за демо-официантом навсегда (по умолчанию 1–9);
//   • имя официанта — исходное (его могут переименовать в профиле).
// Всё идемпотентно: и при каждом входе, и в скрипте scripts/demo-waiter-setup.mjs.

import { createClient } from '@supabase/supabase-js'

// Смена демо-официанта помечается этой строкой в jobs.duties — по ней находим
// «свою» смену дня и не трогаем настоящие.
export const DEMO_JOB_MARK = 'Демо-доступ RestAI'

export function demoConfig() {
  const env = process.env
  const [from, to] = String(env.DEMO_TABLES || '1-9').split('-').map((n) => Number(n.trim()))
  return {
    code: String(env.DEMO_CODE || '1111'),
    phone: env.DEMO_WAITER_PHONE || '+70000000001',
    password: env.DEMO_WAITER_PASSWORD || '',
    name: env.DEMO_WAITER_NAME || 'Демо-официант',
    // «Сыроварня» — тестовый ресторан.
    restaurantId: env.DEMO_RESTAURANT_ID || 'dd89773c-0952-4fd1-9510-514094a928ee',
    tableFrom: from || 1,
    tableTo: to || from || 9,
    supabaseUrl: (env.SUPABASE_URL || env.VITE_SUPABASE_WAITER_URL || '').replace(/\/$/, ''),
    serviceKey: env.SUPABASE_SERVICE_KEY || '',
  }
}

export function adminClient(cfg) {
  return createClient(cfg.supabaseUrl, cfg.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Дата смены — как её считает приложение официанта (UTC, toISOString).
export const todayUtc = () => new Date().toISOString().slice(0, 10)

// Телефон+пароль → настоящая сессия GoTrue (как у входа по SMS).
export async function demoPasswordGrant(cfg) {
  const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: cfg.serviceKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: cfg.phone, password: cfg.password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(`GoTrue token ${res.status}: ${data?.msg ?? data?.error_description ?? data?.error ?? res.statusText}`)
  }
  return data
}

// Строка официанта, привязанная к auth-пользователю демо-аккаунта.
export async function findDemoWaiterId(db, authUserId) {
  const { data, error } = await db.from('waiters').select('id').eq('auth_user_id', authUserId).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

// Столы tableFrom..tableTo ресторана — навсегда за демо-официантом.
export async function ensureTableAssignments(db, cfg, waiterId) {
  const { data: tables, error } = await db
    .from('tables')
    .select('id, number')
    .eq('restaurant_id', cfg.restaurantId)
    .gte('number', cfg.tableFrom)
    .lte('number', cfg.tableTo)
  if (error) throw error

  const { data: existing, error: exErr } = await db
    .from('waiter_table_assignments')
    .select('table_id')
    .eq('waiter_id', waiterId)
    .eq('is_permanent', true)
  if (exErr) throw exErr

  const have = new Set((existing ?? []).map((a) => a.table_id))
  const missing = (tables ?? []).filter((t) => !have.has(t.id))
  if (missing.length) {
    const { error: insErr } = await db.from('waiter_table_assignments').insert(
      missing.map((t) => ({ waiter_id: waiterId, table_id: t.id, is_permanent: true, assigned_date: todayUtc() })),
    )
    if (insErr) throw insErr
  }
  return { tables: (tables ?? []).map((t) => t.number).sort((a, b) => a - b), added: missing.length }
}

// Подтверждённая смена на сегодня. Без свободных мест (slots_available = 0) —
// на карте смен она не выглядит открытой вакансией для настоящих официантов.
export async function ensureTodayShift(db, cfg, waiterId) {
  const today = todayUtc()
  let { data: job, error } = await db
    .from('jobs')
    .select('id')
    .eq('restaurant_id', cfg.restaurantId)
    .eq('shift_date', today)
    .eq('duties', DEMO_JOB_MARK)
    .limit(1)
    .maybeSingle()
  if (error) throw error

  if (!job) {
    const ins = await db
      .from('jobs')
      .insert({
        restaurant_id: cfg.restaurantId,
        shift_date: today,
        start_time: '00:00',
        end_time: '23:59',
        slots_total: 1,
        slots_available: 0,
        pay_amount: 0,
        duties: DEMO_JOB_MARK,
        responsibility_zone: `Столы ${cfg.tableFrom}–${cfg.tableTo}`,
      })
      .select('id')
      .single()
    if (ins.error) throw ins.error
    job = ins.data
  }

  const { data: booking, error: bErr } = await db
    .from('bookings')
    .select('id, status')
    .eq('worker_id', waiterId)
    .eq('job_id', job.id)
    .maybeSingle()
  if (bErr) throw bErr

  if (!booking) {
    const { error: insErr } = await db.from('bookings').insert({ worker_id: waiterId, job_id: job.id, status: 'confirmed' })
    if (insErr) throw insErr
  } else if (booking.status !== 'confirmed') {
    const { error: updErr } = await db.from('bookings').update({ status: 'confirmed' }).eq('id', booking.id)
    if (updErr) throw updErr
  }
  return job.id
}

export async function resetDemoName(db, cfg, waiterId) {
  const { error } = await db.from('waiters').update({ first_name: cfg.name }).eq('id', waiterId)
  if (error) throw error
}
