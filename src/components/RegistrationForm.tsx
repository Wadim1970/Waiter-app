import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabaseWaiter, supabaseWaiterAdmin } from '../lib/supabase'
import RegistrationModal from './RegistrationModal'
import ImagePreview from './ImagePreview'
import styles from './RegistrationForm.module.css'

interface ValidationErrors {
  [key: string]: boolean
}

// Валидация паспортных данных
const validatePassportSeries = (value: string) => /^\d{4}$/.test(value)
const validatePassportNumber = (value: string) => /^\d{6}$/.test(value)
const validateDepartmentCode = (value: string) => /^\d{3}-\d{3}$/.test(value)
const validateINN = (value: string) => /^\d{12}$/.test(value)

// Автоформат кода подразделения: 123456 → 123-456
const formatDepartmentCode = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 6)
  if (digits.length > 3) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`
  }
  return digits
}

export default function RegistrationForm() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  
  // Получаем UUID официанта из localStorage
  const waiterId = localStorage.getItem('waiter_device_id')
  
  // Проверяем нужно ли показать модалку
  const shouldShowModal = searchParams.get('showModal') === 'true'
  const [isModalVisible, setIsModalVisible] = useState(shouldShowModal)
  
  const [formData, setFormData] = useState({
    lastName: '',
    firstName: '',
    patronymic: '',
    birthDate: '',
    gender: '',
    passportSeries: '',
    passportNumber: '',
    passportDepartmentCode: '',
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
    medicalBook: [] as File[],
    personalPhoto1: null as File | null,
    personalPhoto2: null as File | null,
    personalPhoto3: null as File | null
  })

  const [errors, setErrors] = useState<ValidationErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Убираем параметр showModal из URL после монтирования
  useEffect(() => {
    if (shouldShowModal) {
      navigate('/registration', { replace: true })
    }
  }, [shouldShowModal, navigate])

  const validateForm = (): boolean => {
    const newErrors: ValidationErrors = {}

    // Обязательные текстовые поля
    const requiredTextFields = [
      'lastName',
      'firstName',
      'patronymic',
      'birthDate',
      'gender',
      'passportIssueDate',
      'passportIssuedBy',
      'address'
    ]

    requiredTextFields.forEach(field => {
      if (!formData[field as keyof typeof formData]) {
        newErrors[field] = true
      }
    })

    // Серия паспорта — ровно 4 цифры
    if (!validatePassportSeries(formData.passportSeries)) {
      newErrors.passportSeries = true
    }

    // Номер паспорта — ровно 6 цифр
    if (!validatePassportNumber(formData.passportNumber)) {
      newErrors.passportNumber = true
    }

    // Код подразделения — формат XXX-XXX
    if (!validateDepartmentCode(formData.passportDepartmentCode)) {
      newErrors.passportDepartmentCode = true
    }

    // ИНН — ровно 12 цифр
    if (!validateINN(formData.inn)) {
      newErrors.inn = true
    }

    // Фото паспорта (обязательно)
    if (!photos.passportMain) {
      newErrors.passportMain = true
    }
    if (!photos.passportRegistration) {
      newErrors.passportRegistration = true
    }

    // Медкнижка — минимум 2 фото
    if (photos.medicalBook.length < 2) {
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

      const { data: uploadData, error: uploadError } = await supabaseWaiterAdmin.storage
        .from('waiter-documents')
        .upload(filePath, file)

      if (uploadError) {
        console.error('❌ Ошибка загрузки:', uploadError)
        throw uploadError
      }

      console.log('✅ Файл загружен:', uploadData)

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

      // Загружаем медкнижку (до 3 страниц, минимум 2)
      const medicalUrls: string[] = []
      for (let i = 0; i < Math.min(photos.medicalBook.length, 3); i++) {
        const url = await uploadPhoto(photos.medicalBook[i], `medical-book/page-${i + 1}`)
        if (url) medicalUrls.push(url)
      }

      if (medicalUrls.length < 2) {
        throw new Error('Не удалось загрузить фото мед.книжки')
      }

      // Загружаем личные фото (опционально)
      const personal1Url = photos.personalPhoto1
        ? await uploadPhoto(photos.personalPhoto1, 'personal_photos/foto1')
        : null
      const personal2Url = photos.personalPhoto2
        ? await uploadPhoto(photos.personalPhoto2, 'personal_photos/foto2')
        : null
      const personal3Url = photos.personalPhoto3
        ? await uploadPhoto(photos.personalPhoto3, 'personal_photos/foto3')
        : null

      const { data, error } = await supabaseWaiter
        .from('waiters')
        .update({
          last_name: formData.lastName.trim(),
          middle_name: formData.patronymic.trim(),
          first_name: formData.firstName.trim(),
          date_of_birth: formData.birthDate,
          gender: formData.gender,
          passport_series: formData.passportSeries.trim(),
          passport_number: formData.passportNumber.trim(),
          passport_department_code: formData.passportDepartmentCode.trim(),
          passport_issued_by: formData.passportIssuedBy.trim(),
          passport_issue_date: formData.passportIssueDate,
          passport_photo_main_url: passportMainUrl,
          passport_photo_registration_url: passportRegUrl,
          medical_book_photo_1_url: medicalUrls[0] || null,
          medical_book_photo_2_url: medicalUrls[1] || null,
          medical_book_photo_3_url: medicalUrls[2] || null,
          inn: formData.inn.trim(),
          address_registration: formData.address.trim(),
          bio: formData.about.trim() || null,
          cloudtips_link: formData.cloudTipsLink.trim() || null,
          personal_photo_1_url: personal1Url,
          personal_photo_2_url: personal2Url,
          personal_photo_3_url: personal3Url,
          gdpr_consent: formData.personalDataConsent,
          gdpr_consent_date: new Date().toISOString(),
          terms_accepted: formData.termsConsent,
          terms_accepted_date: new Date().toISOString(),
          profile_completed: true,
          status: 'pending',
          updated_at: new Date().toISOString()
        })
        .eq('id', waiterId)
        .select()
        .single()

      if (error) throw error

      console.log('✅ Профиль официанта обновлён:', data)
      
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

  // Обработчики модалки
  const handleModalContinue = () => {
    setIsModalVisible(false)
  }

  const handleModalCancel = () => {
    navigate(-1)
  }

  // Добавление страницы медкнижки по индексу
  const setMedicalPage = (index: number, file: File) => {
    setPhotos(prev => {
      const updated = [...prev.medicalBook]
      updated[index] = file
      return { ...prev, medicalBook: updated }
    })
    setErrors(prev => ({ ...prev, medicalBook: false }))
  }

  // Удаление страницы медкнижки по индексу
  const removeMedicalPage = (index: number) => {
    setPhotos(prev => {
      const updated = [...prev.medicalBook]
      updated.splice(index, 1)
      return { ...prev, medicalBook: updated }
    })
  }

  return (
    <div className={styles.container}>
      {/* Модалка поверх формы */}
      {isModalVisible && (
        <RegistrationModal 
          onContinue={handleModalContinue}
          onCancel={handleModalCancel}
        />
      )}

      {/* Затемнение и размытие контента если модалка открыта */}
      <div className={`${styles.formContent} ${isModalVisible ? styles.blurred : ''}`}>
        <button className={styles.closeButton} onClick={handleClose}>✕</button>

        <div className={styles.content}>
          
          {/* БЛОК 1: Паспортные данные */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>ПАСПОРТНЫЕ ДАННЫЕ</h2>
            
            <p className={styles.photoHint}>сделайте фото паспорта</p>

            <div className={styles.photoRow}>
              <div className={`${styles.photoBox} ${errors.passportMain ? styles.errorBorder : ''}`}>
                <ImagePreview
                  file={photos.passportMain}
                  onAdd={(f) => {
                    setPhotos(prev => ({ ...prev, passportMain: f }))
                    setErrors(prev => ({ ...prev, passportMain: false }))
                  }}
                  onRemove={() => setPhotos(prev => ({ ...prev, passportMain: null }))}
                  alt="Основной разворот паспорта"
                  label="основной разворот"
                />
              </div>
  
              <div className={`${styles.photoBox} ${errors.passportRegistration ? styles.errorBorder : ''}`}>
                <ImagePreview
                  file={photos.passportRegistration}
                  onAdd={(f) => {
                    setPhotos(prev => ({ ...prev, passportRegistration: f }))
                    setErrors(prev => ({ ...prev, passportRegistration: false }))
                  }}
                  onRemove={() => setPhotos(prev => ({ ...prev, passportRegistration: null }))}
                  alt="Страница регистрации паспорта"
                  label="регистрация"
                />
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

            {/* Серия + Номер паспорта */}
            <div className={styles.row}>
              <input 
                type="text" 
                className={`${styles.inputThird} ${errors.passportSeries ? styles.error : ''}`}
                placeholder="Серия"
                value={formData.passportSeries}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4)
                  setFormData({...formData, passportSeries: val})
                  setErrors(prev => ({ ...prev, passportSeries: false }))
                }}
              />
              <input 
                type="text" 
                className={`${styles.inputTwoThirds} ${errors.passportNumber ? styles.error : ''}`}
                placeholder="Номер"
                value={formData.passportNumber}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setFormData({...formData, passportNumber: val})
                  setErrors(prev => ({ ...prev, passportNumber: false }))
                }}
              />
            </div>

            {/* Дата выдачи + Код подразделения */}
            <div className={styles.row}>
              <input 
                type="date" 
                className={`${styles.inputHalf} ${errors.passportIssueDate ? styles.error : ''}`}
                value={formData.passportIssueDate}
                onChange={(e) => {
                  setFormData({...formData, passportIssueDate: e.target.value})
                  setErrors(prev => ({ ...prev, passportIssueDate: false }))
                }}
              />
              <input 
                type="text" 
                className={`${styles.inputHalf} ${errors.passportDepartmentCode ? styles.error : ''}`}
                placeholder="Код подразделения"
                maxLength={7}
                value={formData.passportDepartmentCode}
                onChange={(e) => {
                  const formatted = formatDepartmentCode(e.target.value)
                  setFormData({...formData, passportDepartmentCode: formatted})
                  setErrors(prev => ({ ...prev, passportDepartmentCode: false }))
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
              Необходимо минимум 2 фото: личные данные, врачи/допуск. 
              Также можно добавить аттестацию о профессиональной гигиенической подготовке (ГИГ).
            </p>

            <div className={`${styles.medicalPhotos} ${errors.medicalBook ? styles.errorBlock : ''}`}>
              <div className={styles.medicalPhotoBox}>
                <ImagePreview
                  file={photos.medicalBook[0] ?? null}
                  onAdd={(f) => setMedicalPage(0, f)}
                  onRemove={() => removeMedicalPage(0)}
                  alt="Медкнижка стр. 1"
                  label="стр. 1"
                />
              </div>
              
              <div className={styles.medicalPhotoBox}>
                <ImagePreview
                  file={photos.medicalBook[1] ?? null}
                  onAdd={(f) => setMedicalPage(1, f)}
                  onRemove={() => removeMedicalPage(1)}
                  alt="Медкнижка стр. 2"
                  label="стр. 2"
                />
              </div>
              
              <div className={styles.medicalPhotoBox}>
                <ImagePreview
                  file={photos.medicalBook[2] ?? null}
                  onAdd={(f) => setMedicalPage(2, f)}
                  onRemove={() => removeMedicalPage(2)}
                  alt="Медкнижка стр. 3"
                  label="стр. 3"
                />
              </div>
            </div>

            {errors.medicalBook && (
              <p className={styles.errorMessage}>Загрузите минимум 2 фотографии</p>
            )}
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
                const val = e.target.value.replace(/\D/g, '').slice(0, 12)
                setFormData({...formData, inn: val})
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

            {/* Личные фото */}
            <p className={styles.photoHintPersonal}>
              Добавьте свое фото, так ресторанам будет легче сделать выбор в вашу пользу
            </p>

            <div className={styles.personalPhotosRow}>
              <div className={styles.personalPhotoSlot}>
                <ImagePreview
                  file={photos.personalPhoto1}
                  onAdd={(f) => setPhotos(prev => ({ ...prev, personalPhoto1: f }))}
                  onRemove={() => setPhotos(prev => ({ ...prev, personalPhoto1: null }))}
                  alt="Личное фото 1"
                />
              </div>
              <div className={styles.personalPhotoSlot}>
                <ImagePreview
                  file={photos.personalPhoto2}
                  onAdd={(f) => setPhotos(prev => ({ ...prev, personalPhoto2: f }))}
                  onRemove={() => setPhotos(prev => ({ ...prev, personalPhoto2: null }))}
                  alt="Личное фото 2"
                />
              </div>
              <div className={styles.personalPhotoSlot}>
                <ImagePreview
                  file={photos.personalPhoto3}
                  onAdd={(f) => setPhotos(prev => ({ ...prev, personalPhoto3: f }))}
                  onRemove={() => setPhotos(prev => ({ ...prev, personalPhoto3: null }))}
                  alt="Личное фото 3"
                />
              </div>
            </div>
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
