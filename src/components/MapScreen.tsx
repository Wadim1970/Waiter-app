import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import Header from './Header'
import Footer from './Footer'
import styles from './MapScreen.module.css'

// Исправляем баг с иконками маркеров
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface Restaurant {
  restaurantId: string
  name: string
  address: string
  latitude: number
  longitude: number
  logo_url: string | null
  available_jobs: number
}

export default function MapScreen() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [userLocation, setUserLocation] = useState<[number, number]>([55.7558, 37.6173])
  const [initialLoad, setInitialLoad] = useState(true) // НОВОЕ: отслеживаем первую загрузку

  useEffect(() => {
    getUserLocation()
  }, [])

  useEffect(() => {
    loadRestaurants()
  }, [selectedDate])

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

  const loadRestaurants = async () => {
    try {
      setLoading(true)
      
      const dateString = selectedDate.toISOString().split('T')[0]

      const { data, error } = await supabase
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
            shift_date
          )
        `)
        .gt('jobs.slots_available', 0)
        .eq('jobs.shift_date', dateString)
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)

      if (error) throw error

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
            available_jobs: 0
          })
        }
        const restaurant = restaurantsMap.get(item.restaurantId)!
        restaurant.available_jobs += 1
      })

      setRestaurants(Array.from(restaurantsMap.values()))
    } catch (error) {
      console.error('Ошибка загрузки ресторанов:', error)
    } finally {
      setLoading(false)
      setInitialLoad(false) // НОВОЕ: первая загрузка завершена
    }
  }

  const handleDateSelect = (date: Date) => {
    setSelectedDate(date)
  }

  // ИЗМЕНЕНО: показываем экран загрузки ТОЛЬКО при первой загрузке
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

      {/* НОВОЕ: индикатор загрузки поверх карты */}
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

        {restaurants.map((restaurant) => (
          <Marker
            key={restaurant.restaurantId}
            position={[restaurant.latitude, restaurant.longitude]}
          >
            <Popup>
              <div className={styles.popup}>
                {restaurant.logo_url && (
                  <img 
                    src={restaurant.logo_url} 
                    alt={restaurant.name}
                    className={styles.logo}
                  />
                )}
                <h3>{restaurant.name}</h3>
                <p className={styles.address}>{restaurant.address}</p>
                <p className={styles.jobs}>
                  🔥 {restaurant.available_jobs} {restaurant.available_jobs === 1 ? 'смена' : 'смен'}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <Footer />
    </div>
  )
}
