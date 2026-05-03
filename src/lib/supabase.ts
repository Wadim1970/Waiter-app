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
const supabaseWaiterServiceKey = import.meta.env.VITE_SUPABASE_WAITER_SERVICE_KEY // ← НОВОЕ

if (!supabaseWaiterUrl || !supabaseWaiterAnonKey) {
  throw new Error('Отсутствуют переменные окружения для Supabase Waiter')
}

// ═══════════════════════════════════════════════════════════════
// ФУНКЦИЯ ДЛЯ УСТАНОВКИ ТЕКУЩЕГО ПОЛЬЗОВАТЕЛЯ
// ═══════════════════════════════════════════════════════════════

export async function setCurrentUser(userId: string) {
  try {
    const { error } = await supabaseWaiter.rpc('set_current_user', {
      user_id: userId
    })
    
    if (error) {
      console.error('❌ Ошибка установки current_user:', error)
      throw error
    }
    
    console.log('✅ Current user установлен:', userId)
  } catch (error) {
    console.error('❌ Ошибка вызова set_current_user:', error)
    throw error
  }
}

// Клиент с ANON KEY (для обычных запросов)
export const supabaseWaiter = createClient(supabaseWaiterUrl, supabaseWaiterAnonKey)

// Клиент с SERVICE ROLE KEY (для Storage, обходит RLS)
export const supabaseWaiterAdmin = supabaseWaiterServiceKey 
  ? createClient(supabaseWaiterUrl, supabaseWaiterServiceKey)
  : supabaseWaiter // Фолбэк на ANON если SERVICE KEY не задан

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
