import { adminRoute } from '../_lib/adminRoute.js'
import { uploadPhoto } from '../_lib/menuService.js'

// Фото блюда с компьютера → хранилище фото меню.
//   POST {restaurantId, dishId?, photo, thumb} — картинки base64 (браузер уже
//        уменьшил их); ответ {imageUrl, thumbUrl}. В меню ссылки попадают при
//        сохранении блюда.
export default adminRoute('menu-photo', {
  POST: ({ body, restaurantId }) => uploadPhoto(restaurantId, body),
})
