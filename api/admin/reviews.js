import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getReviews, resolveReview } from '../_lib/reviewsService.js'

// Раздел «Жалобы и оценки».
//   GET   ?restaurantId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — отзывы гостей с посадкой
//         и официантом, сводка, распределение оценок, по официантам и дням
//   PATCH {restaurantId, id, resolved: true|false, note?} — жалоба разобрана
export default adminRoute('reviews', {
  GET: ({ query, restaurantId }) => getReviews(restaurantId, query.from, query.to),
  PATCH: ({ body, restaurantId }) => {
    const id = Number(body.id)
    if (!Number.isInteger(id) || id <= 0) requireUuid('', 'id')
    return resolveReview(restaurantId, { id, resolved: !!body.resolved, note: body.note })
  },
})
