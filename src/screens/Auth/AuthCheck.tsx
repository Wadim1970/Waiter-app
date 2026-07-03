import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase, resolveWaiterId } from '../../lib/supabase'

export default function AuthCheck() {
  const navigate = useNavigate()
  const location = useLocation()
  const hasCheckedRef = useRef(false)
  const [isChecking, setIsChecking] = useState(false)

  useEffect(() => {
    if (hasCheckedRef.current) {
      return
    }
    hasCheckedRef.current = true

    const checkAuth = async () => {
      try {
        setIsChecking(true)

        // Источник правды — сессия Supabase (JWT). Есть валидная сессия →
        // официант залогинен на этом устройстве; supabase-js сам её обновляет.
        const { data: { session } } = await supabase.auth.getSession()

        if (!session) {
          // Нет сессии — чистим возможный устаревший кэш id, показываем Welcome.
          localStorage.removeItem('waiter_device_id')
          return
        }

        // Сессия валидна, но кэш waiter_device_id заполняется только в
        // VerificationScreen — при свежем входе по смс. Если сессия просто
        // ВОССТАНОВИЛАСЬ (persistSession, другая вкладка, localStorage
        // частично почищен) этот шаг не отрабатывает повторно, и кэш
        // остаётся null при абсолютно рабочей сессии — экраны, которые
        // читают id напрямую (TablesScreen и т.п.), молча не находят "своих"
        // данных. Восстанавливаем кэш из БД, если он пуст.
        await resolveWaiterId()

        // Редиректим в приложение только со стартовых страниц.
        if (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/register') {
          navigate('/map', { replace: true })
        }
      } catch (err) {
        console.error('⚠️ Ошибка проверки авторизации (игнорируем):', err)
      } finally {
        setIsChecking(false)
      }
    }

    // НОВОЕ: Запускаем проверку с небольшой задержкой (даём время загрузиться приложению)
    const timer = setTimeout(() => {
      checkAuth()
    }, 100) // 100ms задержка

    return () => clearTimeout(timer)
  }, [navigate, location])

  return null
}
