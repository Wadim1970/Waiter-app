import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getFreelancers, saveReview } from '../_lib/teamService.js'

// Официанты → Фрилансеры: кто выходил на смены по заявкам и отзывы о них.
//   GET  ?restaurantId=…                              — фрилансеры, их смены, смены без отзыва
//   POST {restaurantId, bookingId, rating, comment?}  — оценка и отзыв о смене (официант видит его в приложении)
export default adminRoute('freelancers', {
  GET: ({ restaurantId }) => getFreelancers(restaurantId),
  POST: ({ body, restaurantId }) => saveReview(restaurantId, { ...body, bookingId: requireUuid(body.bookingId, 'bookingId') }),
})
