import { useEffect, useState } from 'react'
import { supabaseRestaurants } from '../lib/supabase'
import styles from './JobDetailsScreen.module.css'

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

  useEffect(() => {
    loadRestaurantDetails()
  }, [restaurantId, shiftDate])

 const loadRestaurantDetails = async () => {
  try {
    setLoading(true)
    
    console.log('🔍 [Оптимизация] Загружаю данные для:', restaurantId, shiftDate)

    // НОВОЕ: Параллельные запросы вместо последовательных
    const [restaurantResult, jobsResult, reviewsResult] = await Promise.all([
      // 1️⃣ Запрос ресторана (только нужные поля)
      supabaseRestaurants
        .from('restaurants')
        .select('restaurantId, name, address, rating_staff, number_of_voters')
        .eq('restaurantId', restaurantId)
        .single(),
      
      // 2️⃣ Запрос вакансий (ограничиваем до 1 записи)
      supabaseRestaurants
        .from('jobs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('shift_date', shiftDate)
        .limit(1),
      
      // 3️⃣ Запрос отзывов (ограничиваем до 5 записей)
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
    // НОВОЕ: Добавлен класс .closing для анимации
    <div className={`${styles.overlay} ${isClosing ? styles.closing : ''}`}>
      <div className={`${styles.screen} ${isClosing ? styles.slideDown : styles.slideUp}`}>
        {/* ИЗМЕНЕНИЕ: onClick вызывает handleClose вместо onClose */}
        <button className={styles.closeButton} onClick={handleClose}>✕</button>

        {/* Хедер с фото */}
        <div className={styles.header}>
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
                  <span className={styles.reviewsLabel}>отзыва</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Контент */}
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
                  <div className={styles.requirementLabel}>Чаевые:</div>
                  <div className={styles.requirementText}>{job.tips_distribution}</div>
                </div>
              </div>
              <div className={styles.requirement}>
                <div className={styles.bullet} />
                <div className={styles.requirementContent}>
                  <div className={styles.requirementLabel}>Питание:</div>
                  <div className={styles.requirementText}>{job.nutrition}</div>
                </div>
              </div>
              <div className={styles.requirement}>
                <div className={styles.bullet} />
                <div className={styles.requirementContent}>
                  <div className={styles.requirementLabel}>Документы:</div>
                  <div className={styles.requirementText}>
                    {Array.isArray(job.required_documents) 
                      ? job.required_documents.join(', ') 
                      : job.required_documents}
                  </div>
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
                  <div className={styles.requirementLabel}>Обязанности:</div>
                  <div className={styles.requirementText}>{job.duties}</div>
                </div>
              </div>
              <div className={styles.requirement}>
                <div className={styles.bullet} />
                <div className={styles.requirementContent}>
                  <div className={styles.requirementLabel}>Технологии:</div>
                  <div className={styles.requirementText}>{job.required_technologies}</div>
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

        {/* Кнопка ��ронирования */}
        <div className={styles.footer}>
          <button className={styles.bookButton} onClick={handleBooking}>
            ЗАБРОНИРОВАТЬ СМЕНУ
          </button>
        </div>
      </div>
    </div>
  )
}
