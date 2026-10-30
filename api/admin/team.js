import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getTeam, addStaff, updateStaff } from '../_lib/teamService.js'

// Официанты → Штатные.
//   GET   ?restaurantId=…                                       — штат и уволенные
//   POST  {restaurantId, lastName, firstName, middleName?, phone, role?} — добавить в штат
//   PATCH {restaurantId, id, lastName?, firstName?, middleName?, phone?, role?, dismissed?}
export default adminRoute('team', {
  GET: ({ restaurantId }) => getTeam(restaurantId),
  POST: ({ body, restaurantId }) => addStaff(restaurantId, body),
  PATCH: ({ body, restaurantId }) => updateStaff(restaurantId, { ...body, id: requireUuid(body.id, 'id') }),
})
