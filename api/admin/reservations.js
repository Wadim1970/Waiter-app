import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { createReservation, updateReservation, deleteReservation } from '../_lib/hallService.js'

// Брони столов.
//   POST   {restaurantId, tableId, startsAt, endsAt, guestCount, guestName?, guestPhone?, comment?}
//   PATCH  {restaurantId, id, …те же поля и status: confirmed|seated|cancelled|no_show}
//   DELETE {restaurantId, id}
// Пересечение с другой бронью того же стола — 409. Нужен X-Admin-Token.
export default adminRoute('reservations', {
  POST: ({ body, restaurantId }) => createReservation(restaurantId, body),
  PATCH: ({ body, restaurantId }) => updateReservation(restaurantId, requireUuid(body.id, 'id'), body),
  DELETE: ({ body, restaurantId }) => deleteReservation(restaurantId, requireUuid(body.id, 'id')),
})
