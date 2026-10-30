import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { createZone, updateZone, deleteZone } from '../_lib/zonesService.js'

// Залы ресторана (список — в GET /api/admin/tables).
//   POST   {restaurantId, name}         — новый зал
//   PATCH  {restaurantId, id, name}     — переименовать
//   PATCH  {restaurantId, order: [id…]} — порядок залов
//   DELETE ?restaurantId=…&id=…         — удалить пустой зал
export default adminRoute('zones', {
  POST: ({ body, restaurantId }) => createZone(restaurantId, body),
  PATCH: ({ body, restaurantId }) => updateZone(restaurantId, Array.isArray(body.order) ? body : { ...body, id: requireUuid(body.id, 'id') }),
  DELETE: ({ query, restaurantId }) => deleteZone(restaurantId, requireUuid(query.id, 'id')),
})
