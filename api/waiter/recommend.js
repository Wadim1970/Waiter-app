import { recommendSet } from '../_lib/suggestService.js'

// Виджет «Подсказка от RestAI» на экране заказа: один связный текст-набор
// (по одному дополнению из подходящих категорий) с обоснованием сочетаний.
// Same-origin Vercel-функция.

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' })
    return
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
  const restaurantId = String(body.restaurantId || '').trim()
  if (!restaurantId) {
    res.status(400).json({ error: 'restaurantId обязателен' })
    return
  }

  try {
    const result = await recommendSet({
      restaurantId,
      cartItemIds: Array.isArray(body.cartItemIds) ? body.cartItemIds : [],
      guest: body.guest,
    })
    res.status(200).json(result)
  } catch (err) {
    console.error('waiter/recommend failed:', err)
    res.status(502).json({ error: 'Не удалось получить рекомендацию' })
  }
}
