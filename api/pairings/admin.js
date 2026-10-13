import { cors, bodyOf, isAdmin, isUuid } from '../_lib/http.js'
import { listPairs, updatePair, addManualPair, deletePair } from '../_lib/pairingService.js'

// Раздел «Пары блюд» в админке.
//   GET    ?restaurantId=…                         — пары, меню, состояние расчёта
//   POST   {restaurantId, dishId, pairDishId, lead, reason} — ручная пара
//   PATCH  {restaurantId, id, status?, lead?, reason?}      — выключить/включить, поправить текст
//   DELETE {restaurantId, id}                      — удалить ручную пару
// Нужен заголовок X-Admin-Token.

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (!isAdmin(req)) {
    res.status(401).json({ error: 'Нужен токен админки' })
    return
  }

  const body = req.method === 'GET' ? {} : bodyOf(req)
  const restaurantId = String(req.method === 'GET' ? req.query.restaurantId || '' : body.restaurantId || '')
  if (!isUuid(restaurantId)) {
    res.status(400).json({ error: 'restaurantId обязателен' })
    return
  }

  try {
    if (req.method === 'GET') {
      res.status(200).json(await listPairs(restaurantId))
    } else if (req.method === 'POST') {
      res.status(200).json(await addManualPair(restaurantId, body))
    } else if (req.method === 'PATCH') {
      if (!isUuid(body.id)) { res.status(400).json({ error: 'id обязателен' }); return }
      res.status(200).json(await updatePair(restaurantId, body.id, body))
    } else if (req.method === 'DELETE') {
      if (!isUuid(body.id)) { res.status(400).json({ error: 'id обязателен' }); return }
      res.status(200).json(await deletePair(restaurantId, body.id))
    } else {
      res.status(405).json({ error: 'Метод не поддерживается' })
    }
  } catch (err) {
    console.error('pairings/admin failed:', err)
    res.status(400).json({ error: String(err?.message || err) })
  }
}
