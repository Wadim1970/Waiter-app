import { adminRoute } from '../_lib/adminRoute.js'
import { getQr, resetQr } from '../_lib/qrService.js'

// QR допуска к смене: сегодняшний токен ресторана, ссылка для пересылки,
// история дней.
//   GET  ?restaurantId=…                — показать
//   POST {restaurantId, action:'reset'} — сбросить токен на сегодня
// Доступ как у остальных разделов: учебный ресторан (ADMIN_OPEN_RESTAURANTS) —
// без токена, любой другой — с X-Admin-Token.
function baseOf(req) {
  const fixed = process.env.QR_PUBLIC_BASE_URL
  if (fixed) return fixed
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  return host ? `${proto}://${host}` : ''
}

export default adminRoute('qr', {
  GET: ({ restaurantId, req }) => getQr(restaurantId, { base: baseOf(req) }),
  POST: ({ restaurantId, body, req }) => {
    if (body.action !== 'reset') {
      const e = new Error('Неизвестное действие')
      e.status = 400
      throw e
    }
    return resetQr(restaurantId, { base: baseOf(req) })
  },
})
