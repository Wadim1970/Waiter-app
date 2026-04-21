import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_WAITER_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_WAITER_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Отсутствуют переменные окружения для Supabase')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Типы для таблицы waiters
export interface WaiterRegistration {
  id?: string
  first_name: string
  phone: string
  employment_type: 'подработка' | 'основная работа'
  phone_verified?: boolean
  created_at?: string
  updated_at?: string
}
