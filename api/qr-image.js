import { cors, hasAdminToken, isUuid } from './_lib/http.js'
import { isDateStr, todayOf, verifyLink, qrImage } from './_lib/qrService.js'

// Картинка QR допуска к смене (PNG).
//   GET ?r=<ресторан>&d=<дата YYYY-MM-DD, по умолчанию сегодня>&s=<подпись>
// Подпись выдаёт админка (страница «QR-коды») для пересылки в мессенджер
// или почтой; без неё нужен X-Admin-Token. Ссылка всегда показывает
// ТЕКУЩИЙ токен за свою дату — после сброса старая картинка не устаревает.
export default async function handler(req, res) {
  if (cors(req, res, 'GET, OPTIONS')) return
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Только GET' })
    return
  }
  const q = req.query || {}
  const restaurantId = String(q.r || q.restaurantId || '')
  const date = String(q.d || todayOf())
  if (!isUuid(restaurantId) || !isDateStr(date)) {
    res.status(400).json({ error: 'Неверная ссылка' })
    return
  }
  if (!(hasAdminToken(req) || verifyLink(restaurantId, date, q.s))) {
    res.status(401).json({ error: 'Нет доступа' })
    return
  }
  try {
    const png = await qrImage(restaurantId, date)
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Disposition', `inline; filename="qr-${date}.png"`)
    res.status(200).send(png)
  } catch (err) {
    if (err?.status) {
      res.status(err.status).json({ error: err.message })
      return
    }
    console.error('qr-image failed:', err)
    res.status(500).json({ error: 'Ошибка сервера' })
  }
}
