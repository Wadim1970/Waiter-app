import { useEffect, useRef, useState } from 'react'
import { getSuggestions, type AiSuggestion } from '../../../lib/api'
import { loadGuestAttributes } from '../../../lib/orders'
import styles from './AiAssistantLayer.module.css'

type Props = {
  restaurantId: string
  orderId: string | null
  seat: number
  cartCount: number
  onAddDish: (dishId: string) => void
}

// Теги по стадии: S1 — консультация (гость ничего не выбрал), S2 — уже собирает
// корзину (дополнения). Тег → как бэкенд отфильтрует меню.
const TAGS_S1 = ['топ-совет', 'мясное', 'рыбное', 'вегетарианское', 'бокал к столу']
const TAGS_S2 = ['бокал к столу', 'десерт', 'топ-совет']

const TAG_ICON: Record<string, string> = {
  'топ-совет': '⭐', 'мясное': '🥩', 'рыбное': '🐟',
  'вегетарианское': '🥗', 'бокал к столу': '🍷', 'десерт': '🍰',
}
// Бейджи объясняют официанту, почему стоит предложить (гостю их не показываем).
const BADGE_LABEL: Record<string, string> = {
  margin: '💰 маржа', hit: '🔥 хит', expiring: '⏳ последний день', special: '⭐ спец дня',
}

export default function AiAssistantLayer({ restaurantId, orderId, seat, cartCount, onAddDish }: Props) {
  const [open, setOpen] = useState(false)
  const [guest, setGuest] = useState<{ gender?: string | null; age?: string | null }>({})
  const [tag, setTag] = useState<string | null>(null)
  const [chain, setChain] = useState<AiSuggestion[]>([])
  const [idx, setIdx] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const shownRef = useRef<Set<string>>(new Set())

  const stage = cartCount > 0 ? 'S2' : 'S1'
  const tags = cartCount > 0 ? TAGS_S2 : TAGS_S1
  const current = chain[idx] || null

  // Атрибуты активного гостя (для персонализации подсказки).
  useEffect(() => {
    if (!orderId) return
    loadGuestAttributes(orderId)
      .then(map => {
        const a = map[seat]
        if (a) setGuest({ gender: a.gender, age: a.age })
      })
      .catch(() => {})
  }, [orderId, seat])

  async function fetchFor(selectedTag: string, exclude: string[]) {
    if (!restaurantId) return
    setLoading(true)
    setError(false)
    try {
      const { suggestions } = await getSuggestions({
        restaurantId, stage, tag: selectedTag, guest, exclude, limit: 3,
      })
      if (suggestions.length === 0) {
        setChain([])
        setIdx(0)
        setError(true)
        return
      }
      suggestions.forEach(s => shownRef.current.add(s.dishId))
      setChain(suggestions)
      setIdx(0)
    } catch {
      setChain([])
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  function pickTag(t: string) {
    setTag(t)
    shownRef.current = new Set()
    fetchFor(t, [])
  }

  async function next() {
    if (!current) return
    shownRef.current.add(current.dishId)
    if (idx + 1 < chain.length) {
      setIdx(idx + 1)
      return
    }
    // Цепочка кончилась — догружаем, исключая уже показанные.
    if (tag) await fetchFor(tag, [...shownRef.current])
  }

  function add() {
    if (!current) return
    onAddDish(current.dishId)
    setAdded(prev => new Set(prev).add(current.dishId))
  }

  if (!open) {
    return (
      <button className={styles.pill} onClick={() => setOpen(true)} aria-label="AI-помощник официанта">
        <span className={styles.pillIcon} aria-hidden="true">🤖</span> Помощник
      </button>
    )
  }

  return (
    <div className={styles.panel} role="dialog" aria-label="AI-помощник официанта">
      <div className={styles.head}>
        <span className={styles.title}><span aria-hidden="true">🤖</span> Помощник · Гость {seat}</span>
        <button className={styles.close} onClick={() => setOpen(false)} aria-label="Свернуть">▾</button>
      </div>

      <div className={styles.tags} data-hscroll>
        {tags.map(t => (
          <button
            key={t}
            className={`${styles.tag} ${tag === t ? styles.tagOn : ''}`}
            onClick={() => pickTag(t)}
          >
            {TAG_ICON[t] ? TAG_ICON[t] + ' ' : ''}{t}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {!tag && !loading && (
          <p className={styles.hint}>Выберите тег — подскажу, что предложить гостю и что сказать.</p>
        )}
        {loading && <p className={styles.hint}>Думаю…</p>}
        {error && tag && !loading && (
          <p className={styles.hint}>Пока нечего предложить по этому тегу.</p>
        )}
        {current && !loading && (
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <span className={styles.name}>{current.name}</span>
              <span className={styles.price}>{current.price} ₽</span>
            </div>
            {current.badges.length > 0 && (
              <div className={styles.badges}>
                {current.badges.map(b => (
                  <span key={b} className={`${styles.badge} ${styles['b_' + b] || ''}`}>
                    {BADGE_LABEL[b] || b}
                  </span>
                ))}
              </div>
            )}
            <p className={styles.pitch}>{current.pitch}</p>
            {current.addon && <div className={styles.addon}>＋ {current.addon}</div>}
            <div className={styles.acts}>
              {added.has(current.dishId) ? (
                <span className={`${styles.btn} ${styles.done}`}>Добавлено ✓</span>
              ) : (
                <button className={`${styles.btn} ${styles.primary}`} onClick={add}>В корзину</button>
              )}
              <button className={`${styles.btn} ${styles.ghost}`} onClick={next}>Другой вариант</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
