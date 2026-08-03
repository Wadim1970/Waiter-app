import { useState, useEffect } from 'react'
import { getRecommendation, type AiSuggestGuest } from './api'

// Хук для виджета «Подсказка от RestAI»: по составу корзины тянет один связный
// ИИ-текст-рекомендацию (набор дополнений с обоснованием). Перезапрашивает при
// изменении состава корзины. Ошибки/отсутствие бэкенда → text=null (виджет
// покажет свой фолбэк).
export function useRestaiHint(
  restaurantId: string,
  cartItemIds: string[],
  guest?: AiSuggestGuest,
): { text: string | null; loading: boolean } {
  const [text, setText] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = [...cartItemIds].sort().join(',')

  useEffect(() => {
    if (!restaurantId || cartItemIds.length === 0) { setText(null); return }
    let cancelled = false
    setLoading(true)
    getRecommendation({ restaurantId, cartItemIds, guest })
      .then(r => { if (!cancelled) setText(r.text) })
      .catch(() => { if (!cancelled) setText(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, key])

  return { text, loading }
}
