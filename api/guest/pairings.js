import { cors, bodyOf, isUuid } from '../_lib/http.js'
import { personalPairings } from '../_lib/pairingService.js'

// Пары под конкретного гостя. Гостевое приложение зовёт это в фоне, когда
// гость открыл меню: к моменту первого «+» ответ уже на телефоне.
//   POST {restaurantId, deviceId}
//   → {personal:false} — о госте ничего не известно, показывать общие пары;
//   → {personal:true, pairings:{<блюдо>:[{dishId, lead, why, personal}]}} —
//     уже без того, что гость не ест; пустой список — у блюда подсказки нет.

export default async function handler(req, res) {
  if (cors(req, res, 'POST, OPTIONS')) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Только POST' }); return }
  const body = bodyOf(req)
  const restaurantId = String(body.restaurantId || '')
  const deviceId = String(body.deviceId || '').slice(0, 200)
  if (!isUuid(restaurantId)) { res.status(400).json({ error: 'restaurantId обязателен' }); return }
  try {
    res.status(200).json(await personalPairings({ restaurantId, deviceId }))
  } catch (err) {
    console.error('guest/pairings failed:', err)
    // Не критично: фронт покажет общие пары.
    res.status(200).json({ personal: false, error: true })
  }
}
