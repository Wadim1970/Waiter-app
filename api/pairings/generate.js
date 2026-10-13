import { cors, bodyOf, isAdmin, isUuid } from '../_lib/http.js'
import { generateForRestaurant, generateAll, getState } from '../_lib/pairingService.js'

// Пересчёт пар блюд (раз в сутки — cron на сервере, или кнопка в админке).
//   POST {restaurantId?, force?}  — запускает расчёт и сразу отвечает 202:
//        он идёт минуту-две, столько nginx соединение не держит. Без
//        restaurantId — по всем ресторанам (так зовёт cron).
//   GET  ?restaurantId=…          — состояние последнего расчёта.
// Нужен заголовок X-Admin-Token.

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, OPTIONS')) return
  if (!isAdmin(req)) {
    res.status(401).json({ error: 'Нужен токен админки' })
    return
  }

  if (req.method === 'GET') {
    const restaurantId = String(req.query.restaurantId || '')
    if (!isUuid(restaurantId)) { res.status(400).json({ error: 'restaurantId обязателен' }); return }
    res.status(200).json({ state: await getState(restaurantId) })
    return
  }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Только GET или POST' }); return }

  const body = bodyOf(req)
  const force = body.force === true
  const restaurantId = body.restaurantId ? String(body.restaurantId) : ''
  if (restaurantId && !isUuid(restaurantId)) { res.status(400).json({ error: 'Неверный restaurantId' }); return }

  res.status(202).json({ started: true, restaurantId: restaurantId || 'all' })

  const job = restaurantId ? generateForRestaurant(restaurantId, { force }) : generateAll({ force })
  job
    .then((r) => console.log('pairings: generate', restaurantId || 'all', JSON.stringify(r)))
    .catch((err) => console.error('pairings: generate failed', restaurantId || 'all', err?.message || err))
}
