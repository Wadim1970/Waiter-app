import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getSchedule, setShift, deleteShift, copyWeek } from '../_lib/teamService.js'

// Официанты → Смены: график сотрудников по неделям.
//   GET    ?restaurantId=…&date=YYYY-MM-DD                  — неделя с этой датой: штат, смены, фрилансеры по заявкам
//   POST   {restaurantId, waiterId, date, startTime, endTime, note?} — поставить или изменить смену
//   POST   {restaurantId, copy: {from, to}}                 — скопировать неделю
//   DELETE ?restaurantId=…&id=…                             — убрать смену
export default adminRoute('schedule', {
  GET: ({ query, restaurantId }) => getSchedule(restaurantId, query.date),
  POST: ({ body, restaurantId }) => (body.copy
    ? copyWeek(restaurantId, body.copy)
    : setShift(restaurantId, { ...body, waiterId: requireUuid(body.waiterId, 'waiterId') })),
  DELETE: ({ query, restaurantId }) => deleteShift(restaurantId, requireUuid(query.id, 'id')),
})
