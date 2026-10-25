import { cors, bodyOf, isUuid } from '../_lib/http.js'
import { cartAdvice, logAdviceEvent } from '../_lib/cartAdviceService.js'

// Совет к корзине гостя. Гостевое приложение зовёт это, когда гость открыл
// корзину или поменял её.
//   POST {restaurantId, deviceId, cart:[{id, quantity}], ordered:[{id, quantity}],
//         dismissed:{dishes:[id], gaps:[gap]}}
//   → {kind:'suggest', meal, gap, source, dish:{id,name,price}, anchorId, title, text}
//   → {kind:'complete', meal, askDessert, title, text} — всё есть, хвалим
//   → {kind:'none'} — молчим
//   POST {restaurantId, deviceId, event:{dishId, anchorId, gap, source, outcome}}
//   — что гость сделал с советом (accepted | rejected | ignored), в статистику.

export default async function handler(req, res) {
  if (cors(req, res, 'POST, OPTIONS')) return
  if (req.method !== 'POST') { res.status(405).json({ error: 'Только POST' }); return }
  const body = bodyOf(req)
  const restaurantId = String(body.restaurantId || '')
  const deviceId = String(body.deviceId || '').slice(0, 200)
  if (!isUuid(restaurantId)) { res.status(400).json({ error: 'restaurantId обязателен' }); return }
  try {
    if (body.event && typeof body.event === 'object') {
      const e = body.event
      res.status(200).json(await logAdviceEvent({
        restaurantId, deviceId,
        dishId: isUuid(e.dishId) ? e.dishId : null,
        anchorId: isUuid(e.anchorId) ? e.anchorId : null,
        gap: e.gap, source: e.source, outcome: e.outcome,
      }))
      return
    }
    res.status(200).json(await cartAdvice({ restaurantId, deviceId, cart: body.cart, ordered: body.ordered, dismissed: body.dismissed }))
  } catch (err) {
    console.error('guest/cart-advice failed:', err)
    // Не критично: корзина работает и без совета.
    res.status(200).json({ kind: 'none', error: true })
  }
}
