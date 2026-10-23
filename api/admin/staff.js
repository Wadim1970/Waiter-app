import { adminRoute } from '../_lib/adminRoute.js'
import { getStaff } from '../_lib/staffService.js'

// Раздел «Официанты»: список за период и средние по ресторану.
//   GET ?restaurantId=…&from=YYYY-MM-DD&to=YYYY-MM-DD (включительно, до 92 дней).
export default adminRoute('staff', {
  GET: ({ query, restaurantId }) => getStaff(restaurantId, query.from, query.to),
})
