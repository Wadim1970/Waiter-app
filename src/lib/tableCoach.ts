// «Коуч стола» — ДЕТЕРМИНИРОВАННЫЙ движок сигналов официанту по конкретному
// столу. В отличие от меню-апселла (там ИИ подбирает сочетания к корзине), тут
// нет ни сети, ни модели: чистые правила поверх уже загруженных позиций заказа
// и времени за столом. Поэтому работает мгновенно, надёжно и почти оффлайн, а
// сюда легко дописывать unit-тесты.
//
// Что подсказываем: опоздание блюда (SLA по cook_time_min), готово-но-не-отдано,
// долго сидят без десерта, пора повторить напитки. Ранжируем по срочности:
// 🔴 red (сервис-факап, гасим до жалобы) → 🟡 yellow → 🟢 green (возможность).

export type CoachLevel = 'red' | 'yellow' | 'green'

export type CoachSignal = {
  id: string
  level: CoachLevel
  icon: string
  // Директива официанту (что сделать). Названия блюд — без кавычек.
  text: string
  // Необязательная произносимая гостю реплика (БЕЗ кавычек). Фронт добавит «…»
  // и выделит жирным; ИИ-полировка переписывает именно её. Держим отдельным
  // полем, чтобы не путать с названием блюда в тексте директивы.
  quote?: string | null
}

export type CoachItem = {
  status: string
  sent_at: string | null
  cook_time_min: number
  dish_name: string
  quantity?: number
  product_type?: string | null
  menu_section?: string | null
}

export type CoachInput = {
  items: CoachItem[]
  sessionStartedAt: string | null
  orderStatus?: string | null
  // created_at активного вызова официанта (kind='service', status='pending')
  // по этому столу — если гость сейчас зовёт. null/нет → вызова нет.
  activeCallAt?: string | null
  now?: number
}

// Пороги (мин). Правим тут, а не по коду.
const DWELL_DESSERT_MIN = 45   // сидят дольше — самое время предложить десерт/кофе
const DRINK_REFILL_MIN = 40    // напитки взяли давно — предложить повторить
const LEVEL_ORDER: Record<CoachLevel, number> = { red: 0, yellow: 1, green: 2 }

const DESSERT_RE = /десерт|торт|чизкейк|тирамису|морож|панакот|штрудел|сырник|пирог|наполеон|эклер|мусс|макарон|крем-?брюле/i
const DRINK_RE = /сок|лимонад|морс|смузи|компот|кофе|чай|раф|коктейл|тоник|вода|милкшейк|какао|эспрессо|капучино|латте/i
const ALCO_RE = /вино|бокал|игрист|просекко|шампан|виски|коньяк|аперол|пиво|сидр|ром\b|текил|джин|ликёр|ликер|вермут|портвейн|наливк|глинтвейн/i
// «Основательная» еда: горячее/пицца/паста + супы. Именно после неё уместен десерт.
const MAIN_RE = /пицц|паст|ризотто|горяч|стейк|бургер|котлет|рагу|филе|шашлык|запечён|запечен|гриль|мяс|рыб|том\s?ям|плов|суп|борщ|уха|солянк/i

function hay(it: CoachItem): string {
  return `${it.dish_name || ''} ${it.menu_section || ''}`
}
function isBeverage(it: CoachItem): boolean {
  return it.product_type === 'drink' || it.product_type === 'alcohol'
    || DRINK_RE.test(hay(it)) || ALCO_RE.test(hay(it))
}
function isDessert(it: CoachItem): boolean {
  return DESSERT_RE.test(hay(it))
}
function isMainFood(it: CoachItem): boolean {
  if (isBeverage(it) || isDessert(it)) return false
  return it.product_type === 'food' || MAIN_RE.test(hay(it))
}

function minutesSince(ts: string | null, now: number): number | null {
  if (!ts) return null
  const t = new Date(ts).getTime()
  if (Number.isNaN(t)) return null
  return (now - t) / 60000
}

function fmtDwell(min: number): string {
  const h = Math.floor(min / 60)
  const m = Math.floor(min % 60)
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`
}

// Главная функция: из состояния стола → ранжированный список сигналов.
export function buildTableSignals(input: CoachInput): CoachSignal[] {
  const { items, sessionStartedAt, orderStatus, activeCallAt } = input
  const now = input.now ?? Date.now()
  const list = Array.isArray(items) ? items : []
  const signals: CoachSignal[] = []

  // Стол закрывается — сервисные сигналы ещё важны, но апселл-возможности молчат.
  const closing = orderStatus === 'bill_requested' || orderStatus === 'paid'

  // Порядок push внутри одного уровня = приоритет: sort стабильна, равные level
  // сохраняют порядок вставки. Поэтому вызов кладём ПЕРВЫМ среди 🔴.

  // ── 🔴 Гость зовёт официанта: самое срочное — человек ждёт прямо сейчас.
  const callMin = minutesSince(activeCallAt ?? null, now)
  if (callMin != null) {
    const waited = callMin < 1 ? 'только что' : `${fmtDwell(callMin)} назад`
    signals.push({
      id: 'call',
      level: 'red',
      icon: '🔔',
      text: `Гость вызвал официанта (${waited}) — подойдите к столу.`,
    })
  }

  // ── 🔴 Опоздание блюда: отбито на кухню (sent), не готово, прошло больше нормы.
  // cook_time_min ещё не проставлен (0) → SLA молчит, ложных тревог нет.
  const overdue: { name: string; over: number }[] = []
  for (const it of list) {
    if (it.status !== 'sent') continue
    if (!it.cook_time_min || it.cook_time_min <= 0) continue
    const since = minutesSince(it.sent_at, now)
    if (since == null) continue
    const over = since - it.cook_time_min
    if (over > 0) overdue.push({ name: it.dish_name || 'Блюдо', over: Math.floor(over) })
  }
  if (overdue.length) {
    overdue.sort((a, b) => b.over - a.over)
    const top = overdue[0]
    const more = overdue.length > 1 ? ` (и ещё ${overdue.length - 1} задерживаются)` : ''
    signals.push({
      id: 'late',
      level: 'red',
      icon: '⏱️',
      text: `${top.name}: готовится дольше нормы, +${top.over} мин${more}. Подойдите к столу и предупредите:`,
      quote: 'Извините, кухня сейчас загружена — ваше блюдо вынесем через пару минут.',
    })
  }

  // ── 🟡 Готово, но не отдано: заберите с раздачи, пока не остыло.
  const ready = list.filter((it) => it.status === 'ready')
  if (ready.length) {
    const names = ready.map((r) => r.dish_name).filter(Boolean)
    const head = names[0] || 'Блюдо'
    const more = ready.length > 1 ? ` +${ready.length - 1}` : ''
    signals.push({
      id: 'ready',
      level: 'yellow',
      icon: '🍽️',
      text: `Готово к подаче: ${head}${more} — заберите с раздачи, пока не остыло.`,
    })
  }

  // ── 🟢 Долго за столом без десерта: предложить десерт/кофе.
  const dwell = minutesSince(sessionStartedAt, now)
  const hasMain = list.some(isMainFood)
  const hasDessert = list.some(isDessert)
  if (!closing && dwell != null && dwell >= DWELL_DESSERT_MIN && hasMain && !hasDessert) {
    signals.push({
      id: 'dwell-dessert',
      level: 'green',
      icon: '☕',
      text: `Гости за столом уже ${fmtDwell(dwell)} — самое время предложить десерт или кофе:`,
      quote: 'Как насчёт десерта к чаю?',
    })
  }

  // ── 🟢 Повторить напитки: беверидж взяли давно, освежить бокалы.
  if (!closing) {
    let oldestDrink: number | null = null
    for (const it of list) {
      if (!isBeverage(it)) continue
      const since = minutesSince(it.sent_at, now)
      if (since == null) continue
      if (oldestDrink == null || since > oldestDrink) oldestDrink = since
    }
    if (oldestDrink != null && oldestDrink >= DRINK_REFILL_MIN) {
      signals.push({
        id: 'refill',
        level: 'green',
        icon: '🥤',
        text: `Напитки брали ${fmtDwell(oldestDrink)} назад — предложите повторить:`,
        quote: 'Обновить напитки?',
      })
    }
  }

  signals.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  return signals
}
