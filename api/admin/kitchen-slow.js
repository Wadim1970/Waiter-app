import { adminRoute } from '../_lib/adminRoute.js'
import { getSlowDishes } from '../_lib/kitchenService.js'

// Раздел «Кухня» → «Долго готовились»: от «ушло на кухню» до «готово» против
// норматива блюда. GET ?restaurantId=…&from=YYYY-MM-DD&to=YYYY-MM-DD
export default adminRoute('kitchen-slow', {
  GET: ({ query, restaurantId }) => getSlowDishes(restaurantId, query.from, query.to),
})
