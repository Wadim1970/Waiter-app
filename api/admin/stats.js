import { adminRoute } from '../_lib/adminRoute.js'
import { getStats } from '../_lib/statsService.js'

// Раздел «Статистика»: выручка, загрузка, блюда, столы, эффект ИИ за период
// и сравнение с таким же периодом до него.
//   GET ?restaurantId=…&from=YYYY-MM-DD&to=YYYY-MM-DD (включительно, до 92 дней).
export default adminRoute('stats', {
  GET: ({ query, restaurantId }) => getStats(restaurantId, query.from, query.to),
})
