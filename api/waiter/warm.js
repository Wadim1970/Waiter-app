import { buildDigest, computeSuggestions, cacheKey, writeCache } from '../_lib/suggestService.js'

// Предрасчёт подсказок при открытии гостя (fire-and-forget с фронта). Считает
// подсказки по тегам текущей стадии и кладёт в тёплый кэш, чтобы первый тап по
// тегу в /suggest вернулся мгновенно. Дайджест меню строим один раз на все
// теги. Число тегов ограничиваем — чтобы не жечь лишние вызовы модели.

const MAX_WARM_TAGS = 3

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

  const tags = (Array.isArray(body.tags) ? body.tags : []).slice(0, MAX_WARM_TAGS)
  if (tags.length === 0) {
    res.status(200).json({ warmed: [] })
    return
  }

  const stage = body.stage
  const guest = body.guest
  const cartItemIds = Array.isArray(body.cartItemIds) ? body.cartItemIds : []
  const limit = body.limit || 3

  try {
    const digest = await buildDigest(restaurantId) // один раз на все теги
    const warmed = await Promise.all(
      tags.map(async (tag) => {
        const result = await computeSuggestions({
          restaurantId, stage, tag, guest, cartItemIds, limit, exclude: [], digest,
        })
        await writeCache(cacheKey({ restaurantId, stage, tag, guest, cartItemIds }), result)
        return tag
      }),
    )
    res.status(200).json({ warmed })
  } catch (err) {
    console.error('waiter/warm failed:', err)
    // Прогрев — не критичный путь: не подсказка, а оптимизация. 200 с пустым.
    res.status(200).json({ warmed: [] })
  }
}
