import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { addAssignment, removeAssignment } from '../_lib/hallService.js'

// Закрепление официантов за столами.
//   POST   {restaurantId, tableId, waiterId, permanent: true}            — навсегда
//   POST   {restaurantId, tableId, waiterId, permanent: false, date}     — на дату
//   DELETE {restaurantId, id}
// Нужен X-Admin-Token.
export default adminRoute('assignments', {
  POST: ({ body, restaurantId }) => addAssignment(restaurantId, {
    tableId: requireUuid(body.tableId, 'tableId'),
    waiterId: requireUuid(body.waiterId, 'waiterId'),
    permanent: !!body.permanent,
    date: body.date,
  }),
  DELETE: ({ body, restaurantId }) => removeAssignment(restaurantId, requireUuid(body.id, 'id')),
})
