import { adminRoute } from '../_lib/adminRoute.js'
import { getBookings } from '../_lib/bookingsService.js'

// Раздел «Брони»: столы с бронями на дату (сегодня … +30 дней), отметки
// гостей (бывал, приложение, лояльность, день рождения, не приходил),
// календарь броней на месяц. Создание и правка броней — /api/admin/reservations.
//   GET ?restaurantId=…&date=YYYY-MM-DD
export default adminRoute('bookings', {
  GET: ({ query, restaurantId }) => getBookings(restaurantId, query.date),
})
