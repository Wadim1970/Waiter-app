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
