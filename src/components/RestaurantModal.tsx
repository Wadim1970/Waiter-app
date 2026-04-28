import { useEffect, useState } from 'react'
import { supabaseRestaurants } from '../lib/supabase'
import styles from './RestaurantModal.module.css'

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

interface RestaurantModalProps {
  restaurantId: string
  shiftDate: string
  onClose: () => void
}

export default function RestaurantModal({ restaurantId, shiftDate, onClose }: RestaurantModalProps) {
  const [data, setData] = useState<RestaurantDetails | null>(null)
  const [loading, setLoading] = useState(true)
 
  useEffect(() => {
    loadRestaurantDetails()
  }, [restaurantId, shiftDate])

  const loadRestaurantDetails = async () => {
    try {
      setLoading(true)
      
      console.log('🔍 Загружаю данные для:', restaurantId, shiftDate)

      // Загружаем данные ресторана
      const { data: restaurantData, error: restaurantError } = await supabaseRestaurants
        .from('restaurants')
        .select('*')
        .eq('restaurantId', restaurantId)
        .single()

      if (restaurantError) {
        console.error('Ошибка загрузки ресторана:', restaurantError)
        throw restaurantError
      }

      console.log('✅ Ресторан:', restaurantData)

      // Загружаем данные вакансии
      const { data: jobData, error: jobError } = await supabaseRestaurants
        .from('jobs')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('shift_date', shiftDate)
        .single()

      if (jobError) {
        console.error('Ошибка загрузки вакансии:', jobError)
        throw jobError
      }

      console.log('✅ Вакансия:', jobData)

      // Загружаем отзывы
      const { data: reviewsData, error: reviewsError } = await supabaseRestaurants
        .from('reviews_waiter')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })

      if (reviewsError) {
        console.error('Ошибка загрузки отзывов:', reviewsError)
      }

      console.log('✅ Отзывы:', reviewsData)

      // Формируем объект данных
      const result: RestaurantDetails = {
        restaurant: {
          id: restaurantData.restaurantId,
          name: restaurantData.name,
          address: restaurantData.address,
          rating_staff: restaurantData.rating_staff,
          number_of_voters: restaurantData.number_of_voters || 0,
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
        reviews: reviewsData || []
      }

      console.log('✅ Финальные данные:', result)
      
      setData(result)
    } catch (error) {
      console.error('❌ Ошибка загрузки данных:', error)
    } finally {
      setLoading(false)
    }
  }

  
  const handleBooking = () => {
    // Пока заглушка - синее окно
    alert('Бронирование (заглушка)')
  }

  // Извлекаем первое слово из названия (до скобок)
  const getShortName = (fullName: string) => {
    return fullName.split('(')[0].trim().toUpperCase()
  }

  if (loading) {
    return (
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <div className={styles.loading}>Загрузка...</div>
        </div>
      </div>
    )
  }

  if (!data || !data.restaurant || !data.job) {
    return (
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <button className={styles.closeButton} onClick={onClose}>✕</button>
          <div className={styles.error}>Нет данных для этой даты</div>
        </div>
      </div>
    )
  }

  const { restaurant, job, reviews } = data

  return (
    <div className={styles.overlay}>
      <div 
        className={styles.modal}
       
      >
        {/* Кнопка закрытия */}
        <button className={styles.closeButton} onClick={onClose}>✕</button>

        {/* Шапка с фото ресторана */}
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
                  {/* НОВОЕ: Зелёная звёздочка */}
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
              <div className={styles.infoValue}>
                  {job.start_time.slice(0, 5)} - {job.end_time.slice(0, 5)}
               </div>
            </div>
            <div className={styles.infoCard}>
              <div className={styles.infoLabel}>оплата</div>
              <div className={styles.payAmount}>
                {job.pay_amount}
                <span className={styles.ruble}>₽</span>
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

        {/* Кнопка бронирования */}
        <div className={styles.footer}>
          <button className={styles.bookButton} onClick={handleBooking}>
            ЗАБРОНИРОВАТЬ СМЕНУ
          </button>
        </div>
      </div>
    </div>
  )
}
