import { supabase, setWaiterId, WAITER_ID_KEY } from './supabase'

// Два входа на одном телефоне: личный (официант-фрилансер, по SMS) и
// демо-вход по коду (кнопка «Вход» → 4 цифры, общий аккаунт для показа
// рестораторам). Сессия у Supabase-клиента одна, поэтому при демо-входе
// личную откладываем в сторону, а по кнопке «Вход для фрилансеров»
// возвращаем — без повторного SMS.

const DEMO_KEY = 'waiter_demo'               // { userId, waiterId, restaurantId }
const STASH_KEY = 'waiter_freelancer_stash'  // отложенный личный вход
const SHIFT_KEY = 'waiter_shift'

type DemoInfo = { userId: string; waiterId: string; restaurantId: string }
type Stash = { access_token: string; refresh_token: string; waiterId: string | null; shift: string | null }

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function getDemoInfo(): DemoInfo | null {
  return readJson<DemoInfo>(DEMO_KEY)
}

// Этот официант — демо (по нему приложение не требует смены, см. TablesScreen).
export function isDemoWaiter(waiterId: string | null | undefined): boolean {
  return !!waiterId && getDemoInfo()?.waiterId === waiterId
}

async function currentSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Код → сессия демо-официанта. Личный вход (если был) откладывается.
export async function loginByCode(code: string): Promise<{ restaurantId: string }> {
  const res = await fetch('/api/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Не удалось войти')

  const session = await currentSession()
  if (session && session.user.id !== data.user.id) {
    const stash: Stash = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      waiterId: localStorage.getItem(WAITER_ID_KEY),
      shift: localStorage.getItem(SHIFT_KEY),
    }
    localStorage.setItem(STASH_KEY, JSON.stringify(stash))
  }

  const { error } = await supabase.auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  })
  if (error) throw error

  const info: DemoInfo = { userId: data.user.id, waiterId: data.user.waiter_id, restaurantId: data.restaurant_id }
  localStorage.setItem(DEMO_KEY, JSON.stringify(info))
  setWaiterId(info.waiterId)
  // Как после скана QR ресторана в начале смены (см. QRScannerScreen).
  localStorage.setItem(SHIFT_KEY, JSON.stringify({ restaurantId: info.restaurantId, scannedAt: Date.now() }))
  return { restaurantId: info.restaurantId }
}

// Кнопка «Вход для фрилансеров»: true — личный вход есть (вернули
// отложенный или он и так текущий), можно в приложение; false — нужна
// регистрация/вход по SMS.
export async function resumeFreelancer(): Promise<boolean> {
  const demo = getDemoInfo()
  const session = await currentSession()

  if (session && session.user.id !== demo?.userId) return true

  const stash = readJson<Stash>(STASH_KEY)
  if (!stash) {
    // Текущая сессия — демо, личного входа на телефоне нет.
    if (session) await supabase.auth.signOut({ scope: 'local' })
    localStorage.removeItem(WAITER_ID_KEY)
    localStorage.removeItem(SHIFT_KEY)
    return false
  }

  const { error } = await supabase.auth.setSession({
    access_token: stash.access_token,
    refresh_token: stash.refresh_token,
  })
  if (error) {
    // Отложенная сессия больше не действует — входить заново по SMS.
    localStorage.removeItem(STASH_KEY)
    localStorage.removeItem(WAITER_ID_KEY)
    localStorage.removeItem(SHIFT_KEY)
    return false
  }

  localStorage.removeItem(STASH_KEY)
  if (stash.waiterId) setWaiterId(stash.waiterId)
  else localStorage.removeItem(WAITER_ID_KEY)
  if (stash.shift) localStorage.setItem(SHIFT_KEY, stash.shift)
  else localStorage.removeItem(SHIFT_KEY)
  return true
}
