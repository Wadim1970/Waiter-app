import { useEffect, useState, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L, { DivIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabaseRestaurants } from '../lib/supabase'
import Header from './Header'
import Footer from './Footer'
import styles from './MapScreen.module.css'

interface Restaurant {
  restaurantId: string
  name: string
  address: string
  latitude: number
  longitude: number
  logo_url: string | null
  available_jobs: number
  avg_pay: number
}

// Кеш для данных ресторанов
const restaurantsCache = new Map<string, Restaurant[]>()

// НОВОЕ: Флаг загрузки для каждой даты (чтобы не загружать дважды)
const loadingDates = new Set<string>()

// Функция создания кастомного маркера
const createCustomMarker = (jobCount: number, avgPay: number): DivIcon => {
  const iconHtml = `
    <div class="custom-marker">
      <div class="marker-count">
        <div class="count-number">${jobCount}</div>
        <div class="count-label">чел</div>
      </div>
      <div class="marker-price">${Math.round(avgPay)}<span class="ruble">₽</span></div>
    </div>
  `
  
  return L.divIcon({
    html: iconHtml,
    className: 'custom-marker-container',
    iconSize: [102, 33],
    iconAnchor: [51, 33],
    popupAnchor: [0, -33]
  })
}

// НОВОЕ: Функция загрузки данных для конкретной даты (переиспользуемая)
const fetchRestaurantsForDate = async (dateString: string): Promise<Restaurant[]> => {
  // Если уже загружаем эту дату - пропускаем
  if (loadingDates.has(dateString)) {
    return []
  }

  // Если уже в кеше - возвращаем из кеша
  if (restaurantsCache.has(dateString)) {
    console.log(`✅ Данные для ${dateString} уже в кеше`)
    return restaurantsCache.get(dateString)!
  }

  try {
    loadingDates.add(dateString)
    console.log(`🔍 Загружаем данные для ${dateString}`)

    const { data, error } = await supabaseRestaurants
      .from('restaurants')
      .select(`
        restaurantId,
        name,
        address,
        latitude,
        longitude,
        logo_url,
        jobs!inner (
          id,
          slots_available,
          shift_date,
          pay_amount
        )
      `)
      .gt('jobs.slots_available', 0)
      .eq('jobs.shift_date', dateString)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)

    if (error) throw error

    if (!data || data.length === 0) {
      console.log(`⚠️ Нет данных для ${dateString}`)
      restaurantsCache.set(dateString, [])
      return []
    }

    const restaurantsMap = new Map<string, Restaurant>()
    
    data?.forEach((item: any) => {
      if (!restaurantsMap.has(item.restaurantId)) {
        restaurantsMap.set(item.restaurantId, {
          restaurantId: item.restaurantId,
          name: item.name,
          address: item.address,
          latitude: parseFloat(item.latitude),
          longitude: parseFloat(item.longitude),
          logo_url: item.logo_url,
          available_jobs: 0,
          avg_pay: 0
        })
      }
      
      const restaurant = restaurantsMap.get(item.restaurantId)!
      
      if (item.jobs && Array.isArray(item.jobs)) {
        item.jobs.forEach((job: any) => {
          if (job.pay_amount && job.slots_available > 0) {
            restaurant.available_jobs += job.slots_available
            if (restaurant.avg_pay === 0) {
              restaurant.avg_pay = parseFloat(job.pay_amount)
            }
          }
        })
      }
    })

    const restaurantsList = Array.from(restaurantsMap.values())
    console.log(`✅ Загружено ${restaurantsList.length} ресторанов для ${dateString}`)
    
    restaurantsCache.set(dateString, restaurantsList)
    return restaurantsList
  } catch (error) {
    console.error(`❌ Ошибка загрузки для ${dateString}:`, error)
    return []
  } finally {
    loadingDates.delete(dateString)
  }
}

export default function MapScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [userLocation, setUserLocation] = useState<[number, number]>([55.7558, 37.6173])
  const [initialLoad, setInitialLoad] = useState(true)

  useEffect(() => {
    getUserLocation()
  }, [])

  useEffect(() => {
    loadRestaurants()
  }, [selectedDate])

  // НОВОЕ: Предзагрузка данных для следующих 6 дней
  useEffect(() => {
    const prefetchNextDays = async () => {
      const today = new Date()
      
      for (let i = 1; i <= 6; i++) {
        const nextDate = new Date(today)
        nextDate.setDate(today.getDate() + i)
        const dateString = nextDate.toISOString().split('T')[0]
        
        setTimeout(() => {
          fetchRestaurantsForDate(dateString)
        }, i * 300)
      }
    }

    // Запускаем предзагрузку через 1 секунду после первой загрузки
    const timer = setTimeout(prefetchNextDays, 1000)
    return () => clearTimeout(timer)
  }, [])

  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation([position.coords.latitude, position.coords.longitude])
        },
        (error) => {
          console.log('Геолокация недоступна:', error)
        }
      )
    }
  }

  const loadRestaurants = useCallback(async () => {
    try {
      setLoading(true)
      
      const dateString = selectedDate.toISOString().split('T')[0]
      
      // Загружаем данные
      const data = await fetchRestaurantsForDate(dateString)
      setRestaurants(data)
      
    } catch (error) {
      console.error('❌ Ошибка загрузки ресторанов:', error)
    } finally {
      setLoading(false)
      setInitialLoad(false)
    }
  }, [selectedDate])

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)
  }

  const markers = useMemo(() => {
    return restaurants.map((restaurant) => (
      <Marker
        key={restaurant.restaurantId}
        position={[restaurant.latitude, restaurant.longitude]}
        icon={createCustomMarker(restaurant.available_jobs, restaurant.avg_pay)}
      >
        <Popup>
          <div className={styles.popup}>
            {restaurant.logo_url && (
              <img 
                src={restaurant.logo_url} 
                alt={restaurant.name}
                className={styles.logo}
                loading="lazy"
              />
            )}
            <h3>{restaurant.name}</h3>
            <p className={styles.address}>{restaurant.address}</p>
            <p className={styles.jobs}>
              🔥 {restaurant.available_jobs} {restaurant.available_jobs === 1 ? 'смена' : 'смен'}
            </p>
            <p className={styles.pay}>
              💰 Средняя оплата: {Math.round(restaurant.avg_pay)} ₽
            </p>
          </div>
        </Popup>
      </Marker>
    ))
  }, [restaurants])

  if (initialLoad && loading) {
    return (
      <div className={styles.loading}>
        <p>Загрузка карты...</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <Header selectedDate={selectedDate} onDateSelect={handleDateSelect} />

      {loading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner}></div>
        </div>
      )}

      <MapContainer
        center={userLocation}
        zoom={13}
        className={styles.map}
        zoomControl={true}
        scrollWheelZoom={true}
        touchZoom={true}
        doubleClickZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {markers}
      </MapContainer>

      <Footer />
    </div>
  )
}
