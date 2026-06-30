import { createClient } from '@supabase/supabase-js'

// ========== БАЗА 1: РЕСТОРАНЫ И СМЕНЫ (Supabase Cloud) ==========
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Отсутствуют переменные окружения для Supabase (restaurants)')
}

export const supabaseRestaurants = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
})

// ========== БАЗА 2: ОФИЦИАНТЫ ==========
const supabaseWaiterUrl = import.meta.env.VITE_SUPABASE_WAITER_URL
const supabaseWaiterAnonKey = import.meta.env.VITE_SUPABASE_WAITER_ANON_KEY

if (!supabaseWaiterUrl || !supabaseWaiterAnonKey) {
  throw new Error('Отсутствуют переменные окружения для Supabase Waiter')
}

// Клиент официантов теперь ХРАНИТ сессию (JWT) и сам её обновляет.
// После входа (VerificationScreen → supabase.auth.setSession) каждый запрос
// несёт access_token, и RLS на стороне БД проверяет auth.uid().
// Один вход по SMS → сессия живёт на устройстве и продлевается refresh-токеном;
// новый SMS нужен только на новом устройстве/номере.
export const supabaseWaiter = createClient(supabaseWaiterUrl, supabaseWaiterAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storageKey: 'waiter-auth',
  },
})

// Для обратной совместимости со старым кодом
export const supabase = supabaseWaiter

// ── Идентичность ────────────────────────────────────────────────────────────
// waiters.id кэшируется в localStorage для синхронного чтения в экранах.
// Это лишь удобство: настоящая личность зашита в JWT-сессии, а доступ к данным
// режет RLS по auth.uid(). Подмена этого значения ничего не даёт — БД отдаст
// только данные владельца токена.
export const WAITER_ID_KEY = 'waiter_device_id'

export function getWaiterId(): string | null {
  return localStorage.getItem(WAITER_ID_KEY)
}

export function setWaiterId(id: string): void {
  localStorage.setItem(WAITER_ID_KEY, id)
}

// ========== ТИПЫ ==========

export interface WaiterRegistration {
  id?: string
  first_name: string
  phone: string
  employment_type: 'permanent' | 'freelance'
  phone_verified?: boolean
  created_at?: string
  updated_at?: string
}
