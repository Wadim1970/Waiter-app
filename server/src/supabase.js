import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'

// Клиент с SERVICE ROLE KEY — живёт ТОЛЬКО на сервере.
// Раньше этот ключ лежал во фронтовом бандле (VITE_…) и был доступен любому.
export const supabaseAdmin = createClient(config.supabaseUrl, config.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
