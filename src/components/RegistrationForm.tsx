import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabaseWaiter, supabaseWaiterAdmin } from '../lib/supabase'
import RegistrationModal from './RegistrationModal'
import styles from './RegistrationForm.module.css'

interface ValidationErrors {
  [key: string]: boolean
}

export default function RegistrationForm() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  
  // Получаем UUID официанта из localStorage
  const waiterId = localStorage.getItem('waiter_device_id')
  
  // НОВОЕ: Проверяем нужно ли показать модалку
  const shouldShowModal = searchParams.get('showModal') === 'true'
  const [isModalVisible, setIsModalVisible] = useState(shouldShowModal)
  
  const [formData, setFormData] = useState({
    lastName: '',
    firstName: '',
    patronymic: '',
    birthDate: '',
    gender: '',
    passportSeries: '',
    passportIssueDate: '',
    passportIssuedBy: '',
    inn: '',
    address: '',
    about: '',
    cloudTipsLink: '',
    personalDataConsent: false,
    termsConsent: false
  })

  const [photos, setPhotos] = useState({
    passportMain: null as File | null,
    passportRegistration: null as File | null,
    medicalBook: [] as File[]
  })

  const [errors, setErrors] = useState<ValidationErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // НОВОЕ: Убираем параметр showModal из URL после монтирования
  useEffect(() => {
    if (shouldShowModal) {
      // Убираем параметр из URL (но модалка уже открыта в state)
      navigate('/registration', { replace: true })
    }
  }, [shouldShowModal, navigate])

  const validateForm = (): boolean => {
    const newErrors: ValidationErrors = {}

    const requiredFields = [
      'lastName',
      'firstName',
      'patronymic',
      'birthDate',
      'gender',
      'passportSeries',
      'passportIssueDate',
      'passportIssuedBy',
      'inn',
      'address'
    ]

    requiredFields.forEach(field => {
      if (!formData[field as keyof typeof formData]) {
        newErrors[field] = true
      }
    })

    if (!photos.passportMain) {
      newErrors.passportMain = true
    }
    if (!photos.passportRegistration) {
      newErrors.passportRegistration = true
    }

    if (photos.medicalBook.length < 3) {
      newErrors.medicalBook = true
    }

    if (!formData.personalDataConsent) {
      newErrors.personalDataConsent = true
    }
    if (!formData.termsConsent) {
      newErrors.termsConsent = true
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const uploadPhoto = async (file: File, path: string): Promise<string | null> => {
  try {
    console.log('📤 Начало загрузки:', file.name, 'Размер:', file.size, 'Тип:', file.type)
    
    const fileExt = file.name.split('.').pop()
    const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`
    const filePath = `${waiterId}/${path}/${fileName}`

    console.log('📂 Путь загрузки:', filePath)

    // ИЗМЕНЕНО: Используем supabaseWaiterAdmin для обхода RLS
    const { data: uploadData, error: uploadError } = await supabaseWaiterAdmin.storage
      .from('waiter-documents')
      .upload(filePath, file)

    if (uploadError) {
      console.error('❌ Ошибка загрузки:', uploadError)
      throw uploadError
    }

    console.log('✅ Файл загружен:', uploadData)

    // Получаем публичный URL
    const { data } = supabaseWaiterAdmin.storage
      .from('waiter-documents')
      .getPublicUrl(filePath)

    console.log('🔗 Публичный URL:', data.publicUrl)

    return data.publicUrl
  } catch (error) {
    console.error('❌ Ошибка загрузки фото:', error)
    alert(`Ошибка загрузки ${file.name}: ${JSON.stringify(error)}`)
    return null
  }
}

  const handleSubmit = async () => {
    if (!waiterId) {
      alert('❌ Ошибка: не найден ID официанта. Пройдите регистрацию заново.')
      navigate('/register')
      return
    }

    if (!validateForm()) {
      alert('⚠️ Заполните все обязательные поля!')
      return
    }

    setIsSubmitting(true)

    try {
      const passportMainUrl = await uploadPhoto(photos.passportMain!, 'passport/main')
      const passportRegUrl = await uploadPhoto(photos.passportRegistration!, 'passport/registration')

      if (!passportMainUrl || !passportRegUrl) {
        throw new Error('Не удалось загрузить фото паспорта')
      }

      const medicalUrls: string[] = []
      for (let i = 0; i < Math.min(photos.medicalBook.length, 3); i++) {
        const url = await uploadPhoto(photos.medicalBook[i], `medical-book/page-${i + 1}`)
        if (url) medicalUrls.push(url)
      }

      if (medicalUrls.length < 3) {
        throw new Error('Не удалось загрузить все фото мед.книжки')
      }

      const passportParts = formData.passportSeries.trim().split(/\s+/)
      const passportSeries = passportParts[0] || ''
      const passportNumber = passportParts.slice(1).join('') || ''

      const { data, error } = await supabaseWaiter
        .from('waiters')
        .update({
          last_name: formData.lastName.trim(),
          middle_name: formData.patronymic.trim(),
          first_name: formData.firstName.trim(),
          date_of_birth: formData.birthDate,
          gender: formData.gender,
          passport_series: passportSeries,
          passport_number: passportNumber,
          passport_issued_by: formData.passportIssuedBy.trim(),
          passport_issue_date: formData.passportIssueDate,
          passport_photo_main_url: passportMainUrl,
          passport_photo_registration_url: passportRegUrl,
          medical_book_photo_1_url: medicalUrls[0],
          medical_book_photo_2_url: medicalUrls[1],
          medical_book_photo_3_url: medicalUrls[2],
          inn: formData.inn.trim(),
          address_registration: formData.address.trim(),
          bio: formData.about.trim() || null,
          cloudtips_link: formData.cloudTipsLink.trim() || null,
          gdpr_consent: formData.personalDataConsent,
          gdpr_consent_date: new Date().toISOString(),
          terms_accepted: formData.termsConsent,
          terms_accepted_date: new Date().toISOString(),
          profile_completed: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', waiterId)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Профиль официанта обновлён:', data)
      
      // НОВОЕ: Переход на синюю заглушку
      navigate('/booking-success')

    } catch (error: any) {
      console.error('❌ Ошибка сохранения:', error)
      alert(`❌ Ошибка: ${error.message || 'Попробуйте снова'}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    navigate(-1)
  }

  // НОВОЕ: Обработчики модалки
  const handleModalContinue = () => {
    setIsModalVisible(false)
  }

  const handleModalCancel = () => {
    navigate(-1) // Возврат на JobDetailsScreen
  }

  const handlePassportMainPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotos(prev => ({ ...prev, passportMain: file }))
      setErrors(prev => ({ ...prev, passportMain: false }))
    }
  }

  const handlePassportRegistrationPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotos(prev => ({ ...prev, passportRegistration: file }))
      setErrors(prev => ({ ...prev, passportRegistration: false }))
    }
  }

  const handleMedicalBookPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      setPhotos(prev => ({ 
        ...prev, 
        medicalBook: [...prev.medicalBook, ...files] 
      }))
      setErrors(prev => ({ ...prev, medicalBook: false }))
    }
  }

  return (
    <div className={styles.container}>
      {/* НОВОЕ: Модалка поверх формы */}
      {isModalVisible && (
        <RegistrationModal 
          onContinue={handleModalContinue}
          onCancel={handleModalCancel}
        />
      )}

      {/* НОВОЕ: Затемнение и размытие контента если модалка открыта */}
      <div className={`${styles.formContent} ${isModalVisible ? styles.blurred : ''}`}>
        <button className={styles.closeButton} onClick={handleClose}>✕</button>

        <div className={styles.content}>
          
          {/* БЛОК 1: Паспортные данные */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>ПАСПОРТНЫЕ ДАННЫЕ</h2>
            
            <p className={styles.photoHint}>сделайте фото паспорта</p>

           <div className={styles.photoRow}>
  <div className={`${styles.photoBox} ${errors.passportMain ? styles.error : ''}`}>
    <input 
      type="file" 
      accept="image/*"
      capture="environment"
      onChange={handlePassportMainPhoto}
      id="passport-main"
      style={{ display: 'none' }}
    />
    <label htmlFor="passport-main" className={styles.photoBoxLabel}>
      <p className={styles.photoLabel}>основной разворот</p>
      <span className={styles.addPhotoButton}>
        {photos.passportMain ? '✓ Загружено' : '+ Добавить'}
      </span>
    </label>
  </div>
  
  <div className={`${styles.photoBox} ${errors.passportRegistration ? styles.error : ''}`}>
    <input 
      type="file" 
      accept="image/*"
      capture="environment"
      onChange={handlePassportRegistrationPhoto}
      id="passport-registration"
      style={{ display: 'none' }}
    />
    <label htmlFor="passport-registration" className={styles.photoBoxLabel}>
      <p className={styles.photoLabel}>регистрация</p>
      <span className={styles.addPhotoButton}>
        {photos.passportRegistration ? '✓ Загружено' : '+ Добавить'}
      </span>
    </label>
  </div>
</div>
            <div className={styles.divider}>
              <span>проверьте данные*</span>
            </div>

            <input 
              type="text" 
              className={`${styles.input} ${errors.lastName ? styles.error : ''}`}
              placeholder="Фамилия"
              value={formData.lastName}
              onChange={(e) => {
                setFormData({...formData, lastName: e.target.value})
                setErrors(prev => ({ ...prev, lastName: false }))
              }}
            />

            <input 
              type="text" 
              className={`${styles.input} ${errors.firstName ? styles.error : ''}`}
              placeholder="Имя"
              value={formData.firstName}
              onChange={(e) => {
                setFormData({...formData, firstName: e.target.value})
                setErrors(prev => ({ ...prev, firstName: false }))
              }}
            />

            <input 
              type="text" 
              className={`${styles.input} ${errors.patronymic ? styles.error : ''}`}
              placeholder="Отчество"
              value={formData.patronymic}
              onChange={(e) => {
                setFormData({...formData, patronymic: e.target.value})
                setErrors(prev => ({ ...prev, patronymic: false }))
              }}
            />

            <div className={styles.row}>
              <input 
                type="date" 
                className={`${styles.inputHalf} ${errors.birthDate ? styles.error : ''}`}
                placeholder="Дата рождения"
                value={formData.birthDate}
                onChange={(e) => {
                  setFormData({...formData, birthDate: e.target.value})
                  setErrors(prev => ({ ...prev, birthDate: false }))
                }}
              />
              <select 
                className={`${styles.inputHalf} ${errors.gender ? styles.error : ''}`}
                value={formData.gender}
                onChange={(e) => {
                  setFormData({...formData, gender: e.target.value})
                  setErrors(prev => ({ ...prev, gender: false }))
                }}
              >
                <option value="">Пол</option>
                <option value="male">Мужской</option>
                <option value="female">Женский</option>
              </select>
            </div>

            <div className={styles.row}>
              <input 
                type="text" 
                className={`${styles.inputHalf} ${errors.passportSeries ? styles.error : ''}`}
                placeholder="Серия и номер"
                value={formData.passportSeries}
                onChange={(e) => {
                  setFormData({...formData, passportSeries: e.target.value})
                  setErrors(prev => ({ ...prev, passportSeries: false }))
                }}
              />
              <input 
                type="date" 
                className={`${styles.inputHalf} ${errors.passportIssueDate ? styles.error : ''}`}
                placeholder="Дата выдачи"
                value={formData.passportIssueDate}
                onChange={(e) => {
                  setFormData({...formData, passportIssueDate: e.target.value})
                  setErrors(prev => ({ ...prev, passportIssueDate: false }))
                }}
              />
            </div>

            <input 
              type="text" 
              className={`${styles.input} ${errors.passportIssuedBy ? styles.error : ''}`}
              placeholder="Кем выдан"
              value={formData.passportIssuedBy}
              onChange={(e) => {
                setFormData({...formData, passportIssuedBy: e.target.value})
                setErrors(prev => ({ ...prev, passportIssuedBy: false }))
              }}
            />

            <p className={styles.autoFillHint}>
              если данные автоматически не заполнились, заполните их вручную
            </p>
          </section>

          {/* БЛОК 2: Медицинская книжка */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>МЕДИЦИНСКАЯ КНИЖКА</h2>
            <p className={styles.hint}>
              Необходимо минимум 3 фото: личные данные, врачи/допуск, 
              аттестация о профессиональной гигиенической подготовке (ГИГ).
            </p>

            <div className={`${styles.medicalPhotos} ${errors.medicalBook ? styles.errorBlock : ''}`}>
              <div className={styles.medicalPhotoBox}>
                <input 
                  type="file" 
                  accept="image/*"
                  capture="environment"
                  onChange={handleMedicalBookPhoto}
                  id="medical-1"
                  style={{ display: 'none' }}
                />
                <label htmlFor="medical-1" className={styles.medicalPhotoLabel}>
                  <span className={styles.addIcon}>
                    {photos.medicalBook[0] ? '✓' : '+'}
                  </span>
                  <p className={styles.medicalLabel}>стр. 1</p>
                </label>
              </div>
              
              <div className={styles.medicalPhotoBox}>
                <input 
                  type="file" 
                  accept="image/*"
                  capture="environment"
                  onChange={handleMedicalBookPhoto}
                  id="medical-2"
                  style={{ display: 'none' }}
                />
                <label htmlFor="medical-2" className={styles.medicalPhotoLabel}>
                  <span className={styles.addIcon}>
                    {photos.medicalBook[1] ? '✓' : '+'}
                  </span>
                  <p className={styles.medicalLabel}>стр. 2</p>
                </label>
              </div>
              
              <div className={styles.medicalPhotoBox}>
                <input 
                  type="file" 
                  accept="image/*"
                  capture="environment"
                  multiple
                  onChange={handleMedicalBookPhoto}
                  id="medical-3"
                  style={{ display: 'none' }}
                />
                <label htmlFor="medical-3" className={styles.medicalPhotoLabel}>
                  <span className={styles.addIcon}>
                    {photos.medicalBook[2] ? '✓' : '+'}
                  </span>
                  <p className={styles.medicalLabel}>стр. 3+</p>
                </label>
              </div>
            </div>

            {errors.medicalBook && (
              <p className={styles.errorMessage}>Загрузите минимум 3 фотографии</p>
            )}

            <input 
              type="file" 
              accept="image/*"
              capture="environment"
              multiple
              onChange={handleMedicalBookPhoto}
              id="medical-more"
              style={{ display: 'none' }}
            />
            <label htmlFor="medical-more" className={styles.addMoreButton}>
              + Добавить ({photos.medicalBook.length} загружено)
            </label>
          </section>

         {/* БЛОК 3: Личная информация */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>ЛИЧНАЯ ИНФОРМАЦИЯ</h2>
            
            <input 
              type="text" 
              className={`${styles.input} ${errors.inn ? styles.error : ''}`}
              placeholder="ИНН"
              value={formData.inn}
              onChange={(e) => {
                setFormData({...formData, inn: e.target.value})
                setErrors(prev => ({ ...prev, inn: false }))
              }}
            />

            <input 
              type="text" 
              className={`${styles.input} ${errors.address ? styles.error : ''}`}
              placeholder="Адрес постоянной регистрации"
              value={formData.address}
              onChange={(e) => {
                setFormData({...formData, address: e.target.value})
                setErrors(prev => ({ ...prev, address: false }))
              }}
            />

            <textarea 
              className={styles.textarea}
              placeholder="Расскажите о себе и предыдущем опыте работы в общепите.... (необязательно)"
              value={formData.about}
              onChange={(e) => setFormData({...formData, about: e.target.value})}
            />
          </section>

          {/* БЛОК 4: Выплата чаевых */}
          <section className={styles.section}>
            <div className={styles.tipsHeader}>
              <h2 className={styles.sectionTitle}>ВЫПЛАТА ЧАЕВЫХ</h2>
              <span className={styles.cloudTipsBadge}>CloudTips</span>
            </div>
            
            <input 
              type="url" 
              className={styles.input}
              placeholder="https://cloudtips.ru/p/... (необязательно)"
              value={formData.cloudTipsLink}
              onChange={(e) => setFormData({...formData, cloudTipsLink: e.target.value})}
            />
            
            <p className={styles.hint}>
              Ваша персональная ссылка для получения безналичного "чая" напрямую.
            </p>
          </section>

          {/* ЧЕКБОКСЫ */}
          <div className={styles.checkboxes}>
            <label className={`${styles.checkbox} ${errors.personalDataConsent ? styles.errorCheckbox : ''}`}>
              <input 
                type="checkbox"
                checked={formData.personalDataConsent}
                onChange={(e) => {
                  setFormData({...formData, personalDataConsent: e.target.checked})
                  setErrors(prev => ({ ...prev, personalDataConsent: false }))
                }}
              />
              <span>
                Я соглашаюсь на <a href="#" className={styles.link}>обработку персональных данных</a> согласно ФЗ-152.
              </span>
            </label>

            <label className={`${styles.checkbox} ${errors.termsConsent ? styles.errorCheckbox : ''}`}>
              <input 
                type="checkbox"
                checked={formData.termsConsent}
                onChange={(e) => {
                  setFormData({...formData, termsConsent: e.target.checked})
                  setErrors(prev => ({ ...prev, termsConsent: false }))
                }}
              />
              <span>
                Я ознакомлен и принимаю <a href="#" className={styles.link}>Условия использования</a> сервиса.
              </span>
            </label>
          </div>

          {/* КНОПКА ОТПРАВКИ */}
          <button 
            className={styles.submitButton}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'СОХРАНЕНИЕ...' : 'ОТПРАВИТЬ НА ПРОВЕРКУ'}
          </button>
        </div>
      </div>
    </div>
  )
}
