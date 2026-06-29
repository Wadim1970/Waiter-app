import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { config } from './config.js'

// Клиент с SERVICE ROLE KEY — живёт ТОЛЬКО на сервере.
// Раньше этот ключ лежал во фронтовом бандле (VITE_…) и был доступен любому.
//
// supabase-js инициализирует Realtime при создании клиента, а тому нужен
// WebSocket. В Node 20 нативного WebSocket нет — отдаём ему ws.
// (Realtime сервису не нужен, только Storage, но клиент требует транспорт.)
export const supabaseAdmin = createClient(config.supabaseUrl, config.serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws },
})
