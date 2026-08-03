import { cacheKey, readCache, writeCache, computeSuggestions } from '../_lib/suggestService.js'

// AI-коуч официанта — подсказки апсейла. Same-origin Vercel-функция.
// Первый тап по тегу (exclude пуст) сначала смотрит тёплый кэш (его наполняет
// /warm при открытии гостя) → мгновенный ответ. «Другой вариант» (exclude
// непуст) и промахи считаем живьём.

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

  const exclude = Array.isArray(body.exclude) ? body.exclude : []
  const cartItemIds = Array.isArray(body.cartItemIds) ? body.cartItemIds : []
  const params = {
    restaurantId,
    stage: body.stage,
    tag: body.tag,
    guest: body.guest,
    exclude,
    cartItemIds,
    limit: body.limit,
  }

  try {
    // Кэш только для первого тапа по тегу (без exclude).
    if (exclude.length === 0 && body.tag) {
      const key = cacheKey(params)
      const hit = await readCache(key)
      if (hit) {
        res.status(200).json({ ...hit, cached: true })
        return
      }
      const result = await computeSuggestions(params)
      await writeCache(key, result)
      res.status(200).json(result)
      return
    }

    const result = await computeSuggestions(params)
    res.status(200).json(result)
  } catch (err) {
    console.error('waiter/suggest failed:', err)
    res.status(502).json({ error: 'Не удалось получить подсказку' })
  }
}
