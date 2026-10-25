import { cors, bodyOf, isUuid } from '../_lib/http.js'
import { answerDessert, guestDessert } from '../_lib/cartAdviceService.js'

// Десерт «чуть позже».
//   POST {restaurantId, deviceId, tableNumber, seat, meal, answer:'yes'|'no'}
//        — ответ гостя на «можно позже предложить десерт?»; «да» — в нужный
//        момент официант получит вызов, а гость — карточку с десертами;
//   GET  ?restaurantId=…&deviceId=… — пора ли показать гостю десерты:
//        {due:false[, at]} или {due:true, title, text, desserts:[{id,name,price,why}]}
//        (показываем один раз).

export default async function handler(req, res) {
  if (cors(req, res, 'GET, POST, OPTIONS')) return
  const src = req.method === 'GET' ? req.query : bodyOf(req)
  const restaurantId = String(src.restaurantId || '')
  const deviceId = String(src.deviceId || '').slice(0, 200)
  if (!isUuid(restaurantId)) { res.status(400).json({ error: 'restaurantId обязателен' }); return }
  try {
    if (req.method === 'GET') {
      res.status(200).json(await guestDessert({ restaurantId, deviceId }))
      return
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Только GET или POST' }); return }
    res.status(200).json(await answerDessert({
      restaurantId, deviceId,
      tableNumber: src.tableNumber, seat: src.seat, meal: src.meal,
      yes: src.answer === 'yes',
    }))
  } catch (err) {
    console.error('guest/dessert failed:', err)
    res.status(200).json({ due: false, saved: false, error: true })
  }
}
