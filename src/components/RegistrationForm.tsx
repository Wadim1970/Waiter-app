import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './RegistrationForm.module.css'

export default function RegistrationForm() {
  const navigate = useNavigate()
  
  const [formData, setFormData] = useState({
    // Паспорт (ИЗМЕНЕНО: три поля вместо одного)
    lastName: '',
    firstName: '',
    patronymic: '',
    birthDate: '',
    gender: '',
    passportSeries: '',
    passportIssueDate: '',
    passportIssuedBy: '',
    
    // Личная информация
    inn: '',
    address: '',
    about: '',
    
    // CloudTips
    cloudTipsLink: '',
    
    // Согласия
    personalDataConsent: false,
    termsConsent: false
  })

  const [photos, setPhotos] = useState({
    passportMain: null as File | null,
    passportRegistration: null as File | null,
    medicalBook: [] as File[]
  })

  const handleSubmit = () => {
    console.log('Данные формы:', formData)
    console.log('Фотографии:', photos)
    alert('Данные отправлены на проверку!')
    navigate('/map')
  }

  const handleClose = () => {
    navigate(-1)
  }

  // НОВОЕ: Обработчики загрузки фото
  const handlePassportMainPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotos(prev => ({ ...prev, passportMain: file }))
      // TODO: В будущем здесь будет распознавание через DADATA
      console.log('📸 Загружено фото основного разворота:', file.name)
    }
  }

  const handlePassportRegistrationPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotos(prev => ({ ...prev, passportRegistration: file }))
      console.log('📸 Загружено фото регистрации:', file.name)
    }
  }

  const handleMedicalBookPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      setPhotos(prev => ({ 
        ...prev, 
        medicalBook: [...prev.medicalBook, ...files] 
      }))
      console.log('📸 Загружено фото мед.книжки:', files.map(f => f.name))
    }
  }

  return (
    <div className={styles.container}>
      {/* Кнопка закрытия */}
      <button className={styles.closeButton} onClick={handleClose}>✕</button>

      {/* Скроллируемый контент */}
      <div className={styles.content}>
        
        {/* БЛОК 1: Паспортные данные (ОБНОВЛЁН) */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>ПАСПОРТНЫЕ ДАННЫЕ</h2>
          
          {/* НОВОЕ: Текст "сделайте фото паспорта" */}
          <p className={styles.photoHint}>сделайте фото паспорта</p>

          {/* НОВОЕ: Два поля для фото */}
          <div className={styles.photoRow}>
            <div className={styles.photoBox}>
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
                <span className={styles.addPhotoButton}>+ Добавить</span>
              </label>
            </div>
            
            <div className={styles.photoBox}>
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
                <span className={styles.addPhotoButton}>+ Добавить</span>
              </label>
            </div>
          </div>

          {/* НОВОЕ: Разделитель "проверьте данные*" */}
          <div className={styles.divider}>
            <span>проверьте данные*</span>
          </div>

          {/* НОВОЕ: Три поля вместо одного */}
          <input 
            type="text" 
            className={styles.input}
            placeholder="Фамилия"
            value={formData.lastName}
            onChange={(e) => setFormData({...formData, lastName: e.target.value})}
          />

          <input 
            type="text" 
            className={styles.input}
            placeholder="Имя"
            value={formData.firstName}
            onChange={(e) => setFormData({...formData, firstName: e.target.value})}
          />

          <input 
            type="text" 
            className={styles.input}
            placeholder="Отчество"
            value={formData.patronymic}
            onChange={(e) => setFormData({...formData, patronymic: e.target.value})}
          />

          <div className={styles.row}>
            <input 
              type="date" 
              className={styles.inputHalf}
              placeholder="Дата рождения"
              value={formData.birthDate}
              onChange={(e) => setFormData({...formData, birthDate: e.target.value})}
            />
            <select 
              className={styles.inputHalf}
              value={formData.gender}
              onChange={(e) => setFormData({...formData, gender: e.target.value})}
            >
              <option value="">Пол</option>
              <option value="male">Мужской</option>
              <option value="female">Женский</option>
            </select>
          </div>

          <div className={styles.row}>
            <input 
              type="text" 
              className={styles.inputHalf}
              placeholder="Серия и номер"
              value={formData.passportSeries}
              onChange={(e) => setFormData({...formData, passportSeries: e.target.value})}
            />
            <input 
              type="date" 
              className={styles.inputHalf}
              placeholder="Дата выдачи"
              value={formData.passportIssueDate}
              onChange={(e) => setFormData({...formData, passportIssueDate: e.target.value})}
            />
          </div>

          <input 
            type="text" 
            className={styles.input}
            placeholder="Кем выдан"
            value={formData.passportIssuedBy}
            onChange={(e) => setFormData({...formData, passportIssuedBy: e.target.value})}
          />

          {/* НОВОЕ: Подсказка внизу */}
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

          <div className={styles.medicalPhotos}>
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
                <span className={styles.addIcon}>+</span>
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
                <span className={styles.addIcon}>+</span>
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
                <span className={styles.addIcon}>+</span>
                <p className={styles.medicalLabel}>стр. 3+</p>
              </label>
            </div>
          </div>

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
            + Добавить
          </label>
        </section>

        {/* БЛОК 3: Личная информация */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>ЛИЧНАЯ ИНФОРМАЦИЯ</h2>
          
          <input 
            type="text" 
            className={styles.input}
            placeholder="ИНН"
            value={formData.inn}
            onChange={(e) => setFormData({...formData, inn: e.target.value})}
          />

          <input 
            type="text" 
            className={styles.input}
            placeholder="Адрес постоянной регистрации"
            value={formData.address}
            onChange={(e) => setFormData({...formData, address: e.target.value})}
          />

          <textarea 
            className={styles.textarea}
            placeholder="Расскажите о себе и предыдущем опыте работы в общепите...."
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
            placeholder="https://cloudtips.ru/p/..."
            value={formData.cloudTipsLink}
            onChange={(e) => setFormData({...formData, cloudTipsLink: e.target.value})}
          />
          
          <p className={styles.hint}>
            Ваша персональная ссылка для получения безналичного "чая" напрямую.
          </p>
        </section>

        {/* ЧЕКБОКСЫ */}
        <div className={styles.checkboxes}>
          <label className={styles.checkbox}>
            <input 
              type="checkbox"
              checked={formData.personalDataConsent}
              onChange={(e) => setFormData({...formData, personalDataConsent: e.target.checked})}
            />
            <span>
              Я соглашаюсь на <a href="#" className={styles.link}>обработку персональных данных</a> согласно ФЗ-152.
            </span>
          </label>

          <label className={styles.checkbox}>
            <input 
              type="checkbox"
              checked={formData.termsConsent}
              onChange={(e) => setFormData({...formData, termsConsent: e.target.checked})}
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
          disabled={!formData.personalDataConsent || !formData.termsConsent}
        >
          ОТПРАВИТЬ НА ПРОВЕРКУ
        </button>
      </div>
    </div>
  )
}
