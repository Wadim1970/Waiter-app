import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getWaiterStats } from '../_lib/staffService.js'

// Карточка официанта за период: итоги и сравнение со средним по ресторану,
// по дням, столы, посадки, доп. продажи (приёмы, категории, блюда).
//   GET ?restaurantId=…&waiterId=…&from=YYYY-MM-DD&to=YYYY-MM-DD
export default adminRoute('waiter', {
  GET: ({ query, restaurantId }) => getWaiterStats(restaurantId, requireUuid(query.waiterId, 'waiterId'), query.from, query.to),
})
