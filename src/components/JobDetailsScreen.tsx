import { useEffect, useState } from 'react'
import { supabaseRestaurants } from '../lib/supabase'
import styles from './JobDetailsScreen.module.css'
import { pluralizeReviews } from '../utils/pluralize'

interface RestaurantDetails {
  restaurant: {
    id: string
    name: string
    address: string
    rating_staff: number
    number_of_voters: number
    photo_url: string
  }
  job: {
    start_time: string
    end_time: string
    pay_amount: number
    dress_code: string
    tips_distribution: string
    nutrition: string
    required_documents: string[]
    responsibility_zone: string
    duties: string
    required_technologies: string
    slots_available: number
  }
  reviews: Array<{
    name: string
    comment: string
    rating: number
    created_at: string
  }>
}

interface JobDetailsScreenProps {
  restaurantId: string
  shiftDate: string
  onClose: () => void // НОВОЕ: Функция закрытия (вместо навигации)
}

export default function JobDetailsScreen({ restaurantId, shiftDate, onClose }: JobDetailsScreenProps) {
  const [data, setData] = useState<RestaurantDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [isClosing, setIsClosing] = useState(false) // НОВОЕ: Для анимации закрытия
  

// НОВОЕ: Состояние для свайпа
const [touchStart, setTouchStart] = useState<number | null>(null)
const [touchEnd, setTouchEnd] = useState<number | null>(null)

// НОВОЕ: Минимальное расстояние свайпа (50px)
const minSwipeDistance = 50

  useEffect(() => {
    loadRestaurantDetails()
  }, [restaurantId, shiftDate])

 const loadRestaurantDetails = async () => {
  try {
    setLoading(true)

    const [restaurantResult, jobsResult, reviewsResult] = await Promise.all([
      supabaseRestaurants
        .from('restaurants')
        .select('restaurantId, name, address, rating_staff, number_of_voters')
        .eq('restaurantId', restaurantId)
        .single(),
      
      supabaseRestaurants
        .from('jobs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('shift_date', shiftDate)
        .limit(1),
      
      supabaseRestaurants
        .from('reviews_waiter')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(5)
    ])
    
    // ИЗМЕНЕНИЕ: Проверяем ошибки после Promise.all
    if (restaurantResult.error) throw restaurantResult.error
    if (jobsResult.error) throw jobsResult.error

    // ИЗМЕНЕНИЕ: Берём первую вакансию из массива
    const jobData = jobsResult.data && jobsResult.data.length > 0 ? jobsResult.data[0] : null
    if (!jobData) throw new Error('Нет вакансий на эту дату')

    const result: RestaurantDetails = {
      restaurant: {
        id: restaurantResult.data.restaurantId,
        name: restaurantResult.data.name,
        address: restaurantResult.data.address,
        rating_staff: restaurantResult.data.rating_staff,
        number_of_voters: restaurantResult.data.number_of_voters || 0,
        photo_url: 'https://utdfzrpkoscyikitceow.supabase.co/storage/v1/object/public/foto_restaurants/foto_holl.png'
      },
      job: {
        start_time: jobData.start_time,
        end_time: jobData.end_time,
        pay_amount: jobData.pay_amount,
        dress_code: jobData.dress_code,
        tips_distribution: jobData.tips_distribution,
        nutrition: jobData.nutrition,
        required_documents: jobData.required_documents,
        responsibility_zone: jobData.responsibility_zone,
        duties: jobData.duties,
        required_technologies: jobData.required_technologies,
        slots_available: jobData.slots_available
      },
      reviews: reviewsResult.data || []
    }
    
    setData(result)
  } catch (error) {
    console.error('❌ Ошибка загрузки данных:', error)
  } finally {
    setLoading(false)
  }
}

  // НОВОЕ: Обработчик закрытия с анимацией
  const handleClose = () => {
    setIsClosing(true) // Запускаем анимацию закрытия
    setTimeout(() => {
      onClose() // Закрываем после завершения анимации
    }, 400) // Совпадает с duration анимации в CSS
  }

  const handleBooking = () => {
    alert('Бронирование (заглушка)')
  }

// НОВОЕ: Обработчики свайпа
const onTouchStart = (e: React.TouchEvent) => {
  setTouchEnd(null) // Сбрасываем конец касания
  setTouchStart(e.targetTouches[0].clientY)
}

const onTouchMove = (e: React.TouchEvent) => {
  setTouchEnd(e.targetTouches[0].clientY)
}

const onTouchEnd = () => {
  if (!touchStart || !touchEnd) return
  
  const distance = touchStart - touchEnd
  const isDownSwipe = distance < -minSwipeDistance // Свайп вниз
  
  if (isDownSwipe) {
    console.log('🔽 Свайп вниз обнаружен, закрываю страницу')
    handleClose()
  }
  
  // Сбрасываем состояние
  setTouchStart(null)
  setTouchEnd(null)
}

  const getShortName = (fullName: string) => {
    return fullName.split('(')[0].trim().toUpperCase()
  }

  if (loading) {
    return (
      <div className={styles.overlay}>
        <div className={styles.screen}>
          <div className={styles.loading}>Загрузка...</div>
        </div>
      </div>
    )
  }

  if (!data || !data.restaurant || !data.job) {
    return (
      <div className={styles.overlay}>
        <div className={styles.screen}>
          <button className={styles.closeButton} onClick={handleClose}>✕</button>
          <div className={styles.error}>Нет данных для этой даты</div>
        </div>
      </div>
    )
  }

  const { restaurant, job, reviews } = data

  return (
  <div className={`${styles.overlay} ${isClosing ? styles.closing : ''}`}>
    {/* ИЗМЕНЕНИЕ: Кнопка закрытия ВЫНЕСЕНА из .screen */}
    <button className={styles.closeButton} onClick={handleClose}>✕</button>

    {/* ИЗМЕНЕНИЕ: Хедер ВЫНЕСЕН из .screen */}
    <div 
  className={styles.header}
  onTouchStart={onTouchStart}
  onTouchMove={onTouchMove}
  onTouchEnd={onTouchEnd}
>
      <img 
        src={restaurant.photo_url} 
        alt={restaurant.name}
        className={styles.headerImage}
      />
      <div className={styles.headerOverlay}>
        <div className={styles.headerContent}>
          <div className={styles.restaurantInfo}>
            <h1 className={styles.restaurantName}>
              {getShortName(restaurant.name)}
            </h1>
            <div className={styles.rating}>
              <span style={{ fontSize: '1.25rem', color: '#03E067' }}>★</span>
              <span className={styles.ratingValue}>
                {restaurant.rating_staff ? restaurant.rating_staff.toFixed(1) : '—'}
              </span>
            </div>
          </div>
          <div className={styles.addressRow}>
              <p className={styles.address}>{restaurant.address}</p>
              <div className={styles.reviewsCount}>
              <span>{restaurant.number_of_voters || 0}</span>
              <span className={styles.reviewsLabel}>
               {pluralizeReviews(restaurant.number_of_voters || 0)}
                  </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* ИЗМЕНЕНИЕ: Футер ВЫНЕСЕН из .screen */}
    <div className={styles.footer}>
      <button className={styles.bookButton} onClick={handleBooking}>
        ЗАБРОНИРОВАТЬ СМЕНУ
      </button>
    </div>

    {/* ИЗМЕНЕНИЕ: .screen теперь содержит ТОЛЬКО контент */}
    <div className={`${styles.screen} ${isClosing ? styles.slideDown : styles.slideUp}`}>
      <div className={styles.content}>
        {/* Время и оплата */}
        <div className={styles.infoRow}>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>смена</div>
            <div className={styles.infoValueWrapper}>
              <div className={styles.infoValue}>
                {job.start_time.slice(0, 5)} - {job.end_time.slice(0, 5)}
              </div>
            </div>
          </div>
          <div className={styles.infoCard}>
            <div className={styles.infoLabel}>оплата</div>
            <div className={styles.payAmountWrapper}>
              <div className={styles.payAmount}>
                {job.pay_amount}<span className={styles.ruble}>₽</span>
              </div>
            </div>
          </div>
        </div>

        {/* Требования и условия */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>ТРЕБОВАНИЯ И УСЛОВИЯ</h2>
          <div className={styles.requirements}>
            <div className={styles.requirement}>
              <div className={styles.bullet} />
              <div className={styles.requirementContent}>
                <span className={styles.requirementLabel}>Дресс-код: </span>
                <span className={styles.requirementText}>{job.dress_code}</span>
              </div>
            </div>
            
            <div className={styles.requirement}>
              <div className={styles.bullet} />
              <div className={styles.requirementContent}>
                <span className={styles.requirementLabel}>Чаевые: </span>
                <span className={styles.requirementText}>{job.tips_distribution}</span>
              </div>
            </div>
            
            <div className={styles.requirement}>
              <div className={styles.bullet} />
              <div className={styles.requirementContent}>
                <span className={styles.requirementLabel}>Питание: </span>
                <span className={styles.requirementText}>{job.nutrition}</span>
              </div>
            </div>
            
            <div className={styles.requirement}>
              <div className={styles.bullet} />
              <div className={styles.requirementContent}>
                <span className={styles.requirementLabel}>Документы: </span>
                <span className={styles.requirementText}>
                  {Array.isArray(job.required_documents) 
                    ? job.required_documents.join(', ') 
                    : job.required_documents}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Описание задач */}
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>ОПИСАНИЕ ЗАДАЧ</h2>
          <div className={styles.requirements}>
            <div className={styles.requirement}>
              <div className={styles.bullet} />
              <div className={styles.requirementContent}>
                <span className={styles.requirementLabel}>Зона ответственности: </span>
                <span className={styles.requirementText}>{job.responsibility_zone}</span>
              </div>
            </div>
            
            <div className={styles.requirement}>
              <div className={styles.bullet} />
              <div className={styles.requirementContent}>
                <span className={styles.requirementLabel}>Обязанности: </span>
                <span className={styles.requirementText}>{job.duties}</span>
              </div>
            </div>
            
            <div className={styles.requirement}>
              <div className={styles.bullet} />
              <div className={styles.requirementContent}>
                <span className={styles.requirementLabel}>Технологии: </span>
                <span className={styles.requirementText}>{job.required_technologies}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Отзывы */}
        {reviews && reviews.length > 0 && (
          <div className={styles.reviewsSection}>
            {reviews.map((review, index) => (
              <div key={index} className={styles.review}>
                <p className={styles.reviewComment}>"{review.comment}"</p>
                <p className={styles.reviewAuthor}>{review.name}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
)
}
