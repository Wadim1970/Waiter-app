import { adminRoute, requireUuid } from '../_lib/adminRoute.js'
import { httpError } from '../_lib/hallService.js'
import { getStudio, getDish, syncFacts, saveFact, setFactStatus, batchConfirm, aiDraft } from '../_lib/trainerFactsService.js'

// Контент-студия тренажёра: факты о блюдах, подтверждение шефом.
//   GET  ?restaurantId=…                    — блюда по разделам с готовностью к уровням
//   GET  ?restaurantId=…&dishId=…           — карточка блюда: факты, подсказки аллергенов, журнал
//   POST {restaurantId, action, actor, …}
//     action: sync                          — черновики из меню; изменённое в меню → в draft
//             save    {dishId, factType, value, confirm?}  — сохранить (и подтвердить)
//             confirm | reject | reset {dishId, factType}  — сменить статус факта
//             batch_confirm {section, factType}            — пакетно (кроме аллергенов)
//             ai_draft {dishId}                            — черновики от ИИ в пустые факты
// actor — имя работающего в студии (пока нет входа в админку), пишется в журнал.
export default adminRoute('trainer-facts', {
  GET: ({ query, restaurantId }) => (query.dishId
    ? getDish(restaurantId, requireUuid(query.dishId, 'dishId'))
    : getStudio(restaurantId)),
  POST: ({ body, restaurantId }) => {
    switch (body.action) {
      case 'sync': return syncFacts(restaurantId)
      case 'save': return saveFact(restaurantId, body)
      case 'confirm':
      case 'reject':
      case 'reset': return setFactStatus(restaurantId, body)
      case 'batch_confirm': return batchConfirm(restaurantId, body)
      case 'ai_draft': return aiDraft(restaurantId, body)
      default: throw httpError(400, 'Неизвестное действие')
    }
  },
})
