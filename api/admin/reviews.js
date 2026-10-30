import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getReviews, getReviewVisit, resolveReview } from '../_lib/reviewsService.js'

const reviewId = (v) => {
  const id = Number(v)
  if (!Number.isInteger(id) || id <= 0) requireUuid('', 'id')
  return id
}

// Раздел «Жалобы и оценки».
//   GET   ?restaurantId=…&from=YYYY-MM-DD&to=YYYY-MM-DD — отзывы гостей с посадкой
//         и официантом, сводка, распределение оценок, по официантам и дням
//   GET   ?restaurantId=…&id=… — визит, за который оставили отзыв: гости, заказ,
//         ожидание блюд, вызовы
//   PATCH {restaurantId, id, resolved: true|false, note?} — жалоба разобрана
export default adminRoute('reviews', {
  GET: ({ query, restaurantId }) => (query.id
    ? getReviewVisit(restaurantId, reviewId(query.id))
    : getReviews(restaurantId, query.from, query.to)),
  PATCH: ({ body, restaurantId }) => resolveReview(restaurantId, { id: reviewId(body.id), resolved: !!body.resolved, note: body.note }),
})
