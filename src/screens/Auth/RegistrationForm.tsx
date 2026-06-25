import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabaseWaiter, supabaseWaiterAdmin } from '../../lib/supabase'
import RegistrationModal from './RegistrationModal'
import ImagePreview from '../shared/ImagePreview'
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

// Маска ввода для дат: ДД.ММ.ГГГГ
const formatDate = (value: string): string => {
  const cleaned = value.replace(/\D/g, '')
  let formatted = cleaned
  if (cleaned.length >= 2) {
    formatted = cleaned.slice(0, 2) + '.' + cleaned.slice(2)
  }
  if (cleaned.length >= 4) {
    formatted = cleaned.slice(0, 2) + '.' + cleaned.slice(2, 4) + '.' + cleaned.slice(4, 8)
  }
  return formatted.slice(0, 10)
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
  const [isOcrLoading, setIsOcrLoading] = useState(false)
  const [visibleMedicalSlots, setVisibleMedicalSlots] = useState(3)
  const [focusedField, setFocusedField] = useState<string | null>(null)

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

  const runOcr = async (file: File) => {
    setIsOcrLoading(true)
    try {
      const form = new FormData()
      form.append('token', import.meta.env.VITE_OCR_TOKEN ?? '')
      form.append('image', file)
      form.append('include_b64_image', '0')
      const res = await fetch('https://api.ocr.ads-soft.ru/recognition', {
        method: 'POST',
        body: form,
      })
      if (!res.ok) return
      const json = await res.json()
      const results: { label: string; text: string }[] =
        json?.data?.[0]?.data?.results ?? []
      const get = (label: string) => results.find(r => r.label === label)?.text ?? ''
      // API возвращает даты в формате YYYY-MM-DD, конвертируем в DD.MM.YYYY
      const convertDate = (s: string) => {
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
        return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
      }
      // serial_1 содержит серию и номер через пробел: "1234 567890"
      const serial1 = get('serial_1').replace(/\D/g, '')
      setFormData(prev => ({
        ...prev,
        lastName: get('lastname') || prev.lastName,
        firstName: get('name') || prev.firstName,
        patronymic: get('middlename') || prev.patronymic,
        gender: get('sex').slice(0, 3) || prev.gender,
        birthDate: convertDate(get('birth_date')) || prev.birthDate,
        passportSeries: serial1.slice(0, 4) || prev.passportSeries,
        passportNumber: serial1.slice(4, 10) || prev.passportNumber,
        passportDepartmentCode: formatDepartmentCode(get('issued_number')) || prev.passportDepartmentCode,
        passportIssueDate: convertDate(get('issued_date')) || prev.passportIssueDate,
        passportIssuedBy: get('issued') || prev.passportIssuedBy,
      }))
    } catch {
      // silent — user can fill manually
    } finally {
      setIsOcrLoading(false)
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

  const addMoreMedicalSlots = () => {
    if (visibleMedicalSlots < 9) {
      setVisibleMedicalSlots(prev => prev + 3)
    }
  }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
    const formatted = formatDate(e.target.value)
    setFormData({...formData, [field]: formatted})
    setErrors(prev => ({ ...prev, [field]: false }))
  }

  const isFormDisabled = !formData.personalDataConsent || !formData.termsConsent

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
                    runOcr(f)
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
              <span>{isOcrLoading ? 'распознаётся паспорт...' : 'проверьте данные*'}</span>
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
                type="text" 
                className={`${styles.inputWide} ${errors.birthDate ? styles.error : ''}`}
                placeholder={focusedField === 'birthDate' ? '__.__.____' : 'Дата рождения'}
                value={formData.birthDate}
                maxLength={10}
                onFocus={() => setFocusedField('birthDate')}
                onBlur={() => setFocusedField(null)}
                onChange={(e) => handleDateChange(e, 'birthDate')}
              />
              <input
                type="text"
                className={`${styles.inputNarrow} ${errors.gender ? styles.error : ''}`}
                placeholder="Пол"
                value={formData.gender}
                maxLength={3}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^а-яА-Яa-zA-Z]/g, '')
                  setFormData({...formData, gender: value.slice(0, 3)})
                  setErrors(prev => ({ ...prev, gender: false }))
                }}
              />
            </div>

            {/* Серия + Номер паспорта */}
            <div className={styles.row}>
              <input 
                type="text" 
                className={`${styles.inputNarrow} ${errors.passportSeries ? styles.error : ''}`}
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
                className={`${styles.inputWide} ${errors.passportNumber ? styles.error : ''}`}
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
                type="text" 
                className={`${styles.inputMedium} ${errors.passportIssueDate ? styles.error : ''}`}
                placeholder={focusedField === 'passportIssueDate' ? '__.__.____' : 'Дата выдачи'}
                value={formData.passportIssueDate}
                maxLength={10}
                onFocus={() => setFocusedField('passportIssueDate')}
                onBlur={() => setFocusedField(null)}
                onChange={(e) => handleDateChange(e, 'passportIssueDate')}
              />
              <input 
                type="text" 
                className={`${styles.inputMedium} ${errors.passportDepartmentCode ? styles.error : ''}`}
                placeholder={focusedField === 'passportDepartmentCode' ? '___-___' : 'Код подразделения'}
                maxLength={7}
                value={formData.passportDepartmentCode}
                onFocus={() => setFocusedField('passportDepartmentCode')}
                onBlur={() => setFocusedField(null)}
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
              {Array.from({ length: visibleMedicalSlots }).map((_, index) => (
                <div key={index} className={styles.medicalPhotoBox}>
                  <ImagePreview
                    file={photos.medicalBook[index] ?? null}
                    onAdd={(f) => {
                      setMedicalPage(index, f)
                    }}
                    onRemove={() => removeMedicalPage(index)}
                    alt={`Медкнижка стр. ${index + 1}`}
                    label={`стр. ${index + 1}${index === 2 ? '+' : ''}`}
                  />
                </div>
              ))}
            </div>

            {visibleMedicalSlots < 9 && (
              <button
                type="button"
                className={styles.addMoreButton}
                onClick={addMoreMedicalSlots}
              >
                + Добавить ({photos.medicalBook.length} {
                  photos.medicalBook.length === 1 ? 'загружена' :
                  photos.medicalBook.length >= 2 && photos.medicalBook.length <= 4 ? 'загружены' :
                  'загружено'
                })
              </button>
            )}

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
            disabled={isFormDisabled || isSubmitting}
          >
            {isSubmitting ? 'СОХРАНЕНИЕ...' : 'ОТПРАВИТЬ НА ПРОВЕРКУ'}
          </button>
        </div>
      </div>
    </div>
  )
}
