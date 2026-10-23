import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { saveLayout, createTable, updateTable } from '../_lib/hallService.js'

// Столы и схема зала.
//   POST  {restaurantId, number, zone?, capacity?, layout?} — новый стол
//   PATCH {restaurantId, layout: [{id, x, y, w, h, shape, rotation}]} — расстановка
//   PATCH {restaurantId, id, number?, zone?, capacity?, isActive?} — свойства стола
// Нужен X-Admin-Token.
export default adminRoute('tables', {
  POST: ({ body, restaurantId }) => createTable(restaurantId, body),
  PATCH: ({ body, restaurantId }) => (Array.isArray(body.layout)
    ? saveLayout(restaurantId, body.layout)
    : updateTable(restaurantId, requireUuid(body.id, 'id'), body)),
})
