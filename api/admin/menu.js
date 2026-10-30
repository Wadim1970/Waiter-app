import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { getMenu, createDish, updateDish, deleteDish, sectionAction } from '../_lib/menuService.js'

// Раздел «Меню»: блюда по разделам гостевого меню, добавки, место у официанта.
//   GET    ?restaurantId=…                         — разделы, блюда, дерево официанта
//   POST   {restaurantId, …блюдо}                  — новое блюдо
//   PATCH  {restaurantId, id, …блюдо}              — изменить блюдо
//   PATCH  {restaurantId, section: {op, …}}        — разделы: order / rename / move / delete
//   DELETE ?restaurantId=…&id=…                    — удалить блюдо (если его ни разу не заказывали)
export default adminRoute('menu', {
  GET: ({ restaurantId }) => getMenu(restaurantId),
  POST: ({ body, restaurantId }) => createDish(restaurantId, body),
  PATCH: ({ body, restaurantId }) => (body.section && typeof body.section === 'object'
    ? sectionAction(restaurantId, body.section)
    : updateDish(restaurantId, requireUuid(body.id, 'id'), body)),
  DELETE: ({ query, restaurantId }) => deleteDish(restaurantId, requireUuid(query.id, 'id')),
})
