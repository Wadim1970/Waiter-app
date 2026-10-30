import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getTables, saveLayout, createTable, updateTable } from '../_lib/hallService.js'

// Столы и схема зала.
//   GET   ?restaurantId=… — залы и столы с расстановкой (Ресторан → Столы)
//   POST  {restaurantId, number, zone?, capacity?, layout?} — новый стол
//         (номер убранного стола — стол возвращается на схему)
//   PATCH {restaurantId, layout: [{id, x, y, w, h, shape, rotation}]} — расстановка
//   PATCH {restaurantId, id, number?, zone?, capacity?, isActive?} — свойства стола
// Нужен X-Admin-Token.
export default adminRoute('tables', {
  GET: ({ restaurantId }) => getTables(restaurantId),
  POST: ({ body, restaurantId }) => createTable(restaurantId, body),
  PATCH: ({ body, restaurantId }) => (Array.isArray(body.layout)
    ? saveLayout(restaurantId, body.layout)
    : updateTable(restaurantId, requireUuid(body.id, 'id'), body)),
})
