import { adminRoute } from '../_lib/adminRoute.js'
import { getHall } from '../_lib/hallService.js'

// Раздел «Зал»: схема зала на дату.
//   GET ?restaurantId=…&date=YYYY-MM-DD — столы, закрепления, что сейчас
//   (сегодня), итоги дня по столам, брони, сводка дня. Нужен X-Admin-Token.
export default adminRoute('hall', {
  GET: ({ query, restaurantId }) => getHall(restaurantId, query.date),
})
