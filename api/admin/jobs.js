import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getJobs, createJobs, updateJob, deleteJob, bookingAction } from '../_lib/teamService.js'

// Официанты → Заявки: смены для фрилансеров (их видят в приложении официанта).
//   GET    ?restaurantId=…                         — предстоящие и прошедшие заявки с откликами, образец условий
//   POST   {restaurantId, dates: [..], startTime, endTime, slots, pay, …условия} — разместить (на несколько дат сразу)
//   PATCH  {restaurantId, id, …поля}               — изменить заявку
//   PATCH  {restaurantId, bookingId, status}       — отклик: approved / rejected / cancelled
//   DELETE ?restaurantId=…&id=…                    — снять заявку (если никого не одобрили)
export default adminRoute('jobs', {
  GET: ({ restaurantId }) => getJobs(restaurantId),
  POST: ({ body, restaurantId }) => createJobs(restaurantId, body),
  PATCH: ({ body, restaurantId }) => (body.bookingId
    ? bookingAction(restaurantId, { ...body, bookingId: requireUuid(body.bookingId, 'bookingId') })
    : updateJob(restaurantId, requireUuid(body.id, 'id'), body)),
  DELETE: ({ query, restaurantId }) => deleteJob(restaurantId, requireUuid(query.id, 'id')),
})
