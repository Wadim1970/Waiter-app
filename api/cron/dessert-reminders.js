import { cors, bodyOf, hasAdminToken } from '../_lib/http.js'
import { tickDessertReminders } from '../_lib/cartAdviceService.js'

// Раз в минуту (cron, RestAI/deploy/dessert-reminders.sh): у кого из гостей
// пришло время десерта — вызвать официанта (вызов «десерт» + пуш).
//   POST {pushUrl?} с X-Admin-Token. pushUrl — сервер пушей официанта
//   (VITE_WAITER_API_URL гостевого приложения); без него — вызов без пуша
//   (официант всё равно увидит его в приложении).

export default async function handler(req, res) {
  if (cors(req, res, 'POST, OPTIONS')) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Только POST' }); return }
  if (!hasAdminToken(req)) { res.status(401).json({ error: 'Нужен X-Admin-Token' }); return }
  const body = bodyOf(req)
  const pushUrl = /^https?:\/\//.test(String(body.pushUrl || '')) ? String(body.pushUrl) : (process.env.WAITER_PUSH_URL || '')
  try {
    res.status(200).json(await tickDessertReminders({ pushUrl }))
  } catch (err) {
    console.error('cron/dessert-reminders failed:', err)
    res.status(500).json({ error: err?.message || 'failed' })
  }
}
