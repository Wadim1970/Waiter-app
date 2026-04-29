import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AuthCheck() {
  const navigate = useNavigate()
  const location = useLocation()
  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (hasCheckedRef.current) {
      return
    }
    hasCheckedRef.current = true

    const checkAuth = async () => {
      const savedWaiterId = localStorage.getItem('waiter_device_id')

      if (!savedWaiterId) {
        console.log('❌ Device ID не найден')
        return
      }

      try {
        const { data: waiter, error } = await supabase
          .from('waiters')
          .select('id, first_name, phone_verified')
          .eq('id', savedWaiterId)
          .maybeSingle()

        if (error) {
          console.error('Ошибка проверки официанта:', error)
          return
        }

        if (waiter && waiter.phone_verified === true) {
          console.log('✅ Официант найден и верифицирован:', waiter.first_name)
          
          // НОВОЕ: Автоматический переход на карту только если на главной странице
          if (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/register') {
            console.log('🔄 Перенаправляю на /map')
            navigate('/map', { replace: true })
          }
        } else if (waiter && waiter.phone_verified === false) {
          console.log('⚠️ Официант найден, но не верифицирован')
          // Пользователь на этапе верификации, не редиректим
        } else {
          console.log('❌ Официант не найден, возможно удален из базы')
          localStorage.removeItem('waiter_device_id')
        }
      } catch (err) {
        console.error('Ошибка проверки авторизации:', err)
      }
    }

    checkAuth()
  }, [navigate, location])

  return null
}
