import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

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
      const savedWaiterId = localStorage.getItem('waiter_device_id')

      if (!savedWaiterId) {
        console.log('❌ Device ID не найден')
        return
      }

      try {
        setIsChecking(true)
        
        // НОВОЕ: Добавляем таймаут для запроса
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 5000) // 5 секунд максимум
        )

        const checkPromise = supabase
          .from('waiters')
          .select('id, first_name, phone_verified')
          .eq('id', savedWaiterId)
          .maybeSingle()

        // НОВОЕ: Race между запросом и таймаутом
        const { data: waiter, error } = await Promise.race([
          checkPromise,
          timeoutPromise
        ]) as any

        if (error) {
          console.error('Ошибка проверки официанта:', error)
          return
        }

        if (waiter && waiter.phone_verified === true) {
          console.log('✅ Официант найден и верифицирован:', waiter.first_name)
          
          // НОВОЕ: Редирект только если на главной странице
          if (location.pathname === '/' || location.pathname === '/login' || location.pathname === '/register') {
            console.log('🔄 Перенаправляю на /map')
            navigate('/map', { replace: true })
          }
        } else if (waiter && waiter.phone_verified === false) {
          console.log('⚠️ Официант найден, но не верифицирован')
        } else {
          console.log('❌ Официант не найден, возможно удален из базы')
          localStorage.removeItem('waiter_device_id')
        }
      } catch (err) {
        // НОВОЕ: Если таймаут или ошибка — просто игнорируем и показываем WelcomeScreen
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
