import { createClient } from '@supabase/supabase-js'

// ========== БАЗА 1: РЕСТОРАНЫ И СМЕНЫ (Supabase Cloud) ==========
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Отсутствуют переменные окружения для Supabase (restaurants)')
}

export const supabaseRestaurants = createClient(supabaseUrl, supabaseAnonKey)

// ========== БАЗА 2: ОФИЦИАНТЫ (VPS) ==========
const supabaseWaiterUrl = import.meta.env.VITE_SUPABASE_WAITER_URL
const supabaseWaiterAnonKey = import.meta.env.VITE_SUPABASE_WAITER_ANON_KEY

if (!supabaseWaiterUrl || !supabaseWaiterAnonKey) {
  throw new Error('Отсутствуют переменные окружения для Supabase Waiter')
}

export const supabaseWaiter = createClient(supabaseWaiterUrl, supabaseWaiterAnonKey)

// Для обратной совместимости со старым кодом
export const supabase = supabaseWaiter

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
