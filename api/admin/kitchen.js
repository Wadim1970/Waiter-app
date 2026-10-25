import { adminRoute } from '../_lib/adminRoute.js'
import { getKitchen, kitchenAction } from '../_lib/kitchenService.js'

// Раздел «Кухня»: стоп-лист и приоритет в рекомендациях.
//   GET   ?restaurantId=…  — все блюда: стоп, «срочно продать», приоритет, маржа, продажи за 30 дней
//   PATCH {restaurantId, action, ids, …} — stop / unstop / urgent / unurgent / priority
export default adminRoute('kitchen', {
  GET: ({ restaurantId }) => getKitchen(restaurantId),
  PATCH: ({ body, restaurantId }) => kitchenAction(restaurantId, body),
})
