import { adminRoute } from '../_lib/adminRoute.js'
import { getBookingGuest } from '../_lib/bookingsService.js'

// Карточка гостя брони — только его история в ЭТОМ ресторане: визиты,
// что заказывает, средний чек, брони, отзывы, демо-лояльность.
//   GET ?restaurantId=…&phone=+79…
export default adminRoute('booking-guest', {
  GET: ({ query, restaurantId }) => getBookingGuest(restaurantId, query.phone),
})
