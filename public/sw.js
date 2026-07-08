// Service Worker для обработки Web Share Target API

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  
  // Обрабатываем POST запрос от Share Target
  if (event.request.method === 'POST' && url.pathname === '/registration') {
    event.respondWith(
      (async () => {
        const formData = await event.request.formData()
        const text = formData.get('text') || ''
        const title = formData.get('title') || ''
        
        // Перенаправляем на форму регистрации с данными
        const redirectUrl = `/registration?text=${encodeURIComponent(text)}&title=${encodeURIComponent(title)}`
        
        return Response.redirect(redirectUrl, 303)
      })()
    )
  }
})

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim())
})

// Вызов официанта — доставка, пока приложение полностью свёрнуто (не
// просто вкладка в фоне: JS страницы в этот момент не выполняется
// вообще, только push умеет разбудить именно Service Worker для показа
// системного уведомления).
self.addEventListener('push', (event) => {
  let data = { title: 'Вызов официанта', body: '' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // payload не JSON — покажем хотя бы заголовок по умолчанию
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/Waiter_logo-192.png',
      badge: '/icons/Waiter_logo-192.png',
      vibrate: [400, 200, 400, 200, 400], // Android; iOS игнорирует
      tag: 'waiter-call', // новое уведомление заменяет предыдущее, не копится стопкой
      renotify: true, // без этого повтор с тем же tag заменяет молча — без звука и вибро
      requireInteraction: true,
      data: { callId: data.callId },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = allClients.find((c) => 'focus' in c)
      if (existing) {
        existing.focus()
        return
      }
      await clients.openWindow('/')
    })()
  )
})
