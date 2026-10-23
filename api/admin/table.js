import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getTableDay } from '../_lib/hallService.js'

// Панель стола: посадки дня (заказ по местам, вызовы, доп. продажи, отзыв)
// и брони на 30 дней вперёд.
//   GET ?restaurantId=…&tableId=…&date=YYYY-MM-DD. Нужен X-Admin-Token.
export default adminRoute('table', {
  GET: ({ query, restaurantId }) => getTableDay(restaurantId, requireUuid(query.tableId, 'tableId'), query.date),
})
