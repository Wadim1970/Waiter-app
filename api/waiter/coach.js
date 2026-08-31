import { polishCoachSignals } from '../_lib/suggestService.js'

// ИИ-полировка реплик «коуча стола» на экране заказа. Необязательный слой:
// клиент показывает детерминированные сигналы сразу, а сюда шлёт их тексты и
// профиль гостя, чтобы получить более тёплые/уместные произносимые фразы (в «…»).
// При любой проблеме возвращаем 200 с polished:null — клиент оставляет свой
// текст, экран не должен падать из-за необязательного улучшения.

function safeParse(s) {
  try { return JSON.parse(s) } catch { return {} }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Только POST' })
    return
  }
  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {})
  const signals = Array.isArray(body.signals) ? body.signals : []
  if (signals.length === 0) {
    res.status(200).json({ polished: null, source: 'empty' })
    return
  }

  try {
    const result = await polishCoachSignals({ signals, guest: body.guest })
    res.status(200).json(result)
  } catch (err) {
    console.error('waiter/coach failed:', err)
    res.status(200).json({ polished: null, source: 'error' })
  }
}
