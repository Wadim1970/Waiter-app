import { useEffect, useState, useCallback, useMemo, memo } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L, { DivIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabaseRestaurants } from '../../lib/supabase'
import { useMapStore } from '../../store/mapStore' // НОВОЕ: Подключение Zustand
import Header from '../shared/Header'
import Footer from '../shared/Footer'
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

// НОВОЕ: Пропсы для MapScreen (нужны для "Hide, don't Unmount")
interface MapScreenProps {
  onJobClick?: (restaurantId: string, shiftDate: string) => void
}

// Кеш для данных ресторанов
const restaurantsCache = new Map<string, Restaurant[]>()

// Флаг загрузки для каждой даты
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

// Функция загрузки данных для конкретной даты
const fetchRestaurantsForDate = async (dateString: string): Promise<Restaurant[]> => {
  if (loadingDates.has(dateString)) {
    return []
  }

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

// НОВОЕ: Компонент для отслеживания событий карты
function MapEvents() {
  const { setCenter, setZoom } = useMapStore()
  
  useMapEvents({
    // НОВОЕ: Сохраняем центр карты при перемещении
    moveend: (e) => {
      const center = e.target.getCenter()
      setCenter([center.lat, center.lng])
    },
    // НОВОЕ: Сохраняем зум при изменении
    zoomend: (e) => {
      setZoom(e.target.getZoom())
    }
  })
  
  return null
}

// НОВОЕ: Оборачиваем компонент в React.memo для предотвращения лишних рендеров
function MapScreen({ onJobClick }: MapScreenProps) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  // ИЗМЕНЕНИЕ: selectedDate теперь из Zustand
  const { selectedDate, setSelectedDate, center, zoom } = useMapStore()
  const [userLocation, setUserLocation] = useState<[number, number]>([55.7558, 37.6173])
  const [initialLoad, setInitialLoad] = useState(true)

  useEffect(() => {
    getUserLocation()
  }, [])

  useEffect(() => {
    loadRestaurants()
  }, [selectedDate])

  // Предзагрузка данных для следующих 6 дней
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
      
      const data = await fetchRestaurantsForDate(dateString)
      setRestaurants(data)
      
    } catch (error) {
      console.error('❌ Ошибка загрузки ресторанов:', error)
    } finally {
      setLoading(false)
      setInitialLoad(false)
    }
  }, [selectedDate])

  // ИЗМЕНЕНИЕ: handleDateSelect теперь обновляет Zustand
  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)
  }

  // НОВОЕ: useMemo для маркеров (оптимизация рендера)
  const markers = useMemo(() => {
    return restaurants.map((restaurant) => (
      <Marker
        key={restaurant.restaurantId}
        position={[restaurant.latitude, restaurant.longitude]}
        icon={createCustomMarker(restaurant.available_jobs, restaurant.avg_pay)}
        eventHandlers={{
  click: (e) => {
    // НОВОЕ: Останавливаем все события карты
    const map = e.target._map
    if (map) {
      map.stop() // Останавливает загрузку тайлов!
    }
    
    if (onJobClick) {
      onJobClick(restaurant.restaurantId, selectedDate.toISOString().split('T')[0])
    }
  }
}}
      />
    ))
  }, [restaurants, selectedDate, onJobClick])

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

      {/* ИЗМЕНЕНИЕ: center и zoom теперь из Zustand */}
      <MapContainer
        key="main-map"
        center={center}
        zoom={zoom}
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

        {/* НОВОЕ: Компонент для отслеживания событий карты */}
        <MapEvents />

        {markers}
      </MapContainer>

      <Footer />
    </div>
  )
}

// НОВОЕ: Экспортируем компонент обёрнутый в React.memo
export default memo(MapScreen)
