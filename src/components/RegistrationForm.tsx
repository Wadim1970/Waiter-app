import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './RegistrationForm.module.css'

export default function RegistrationForm() {
  const navigate = useNavigate()
    
  const [formData, setFormData] = useState({
    // Паспорт
    fullName: '',
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
    // TODO: Отправка на сервер
    console.log('Данные формы:', formData)
    console.log('Фотографии:', photos)
    alert('Данные отправлены на проверку!')
    navigate('/map')
  }

  const handleClose = () => {
    navigate(-1)
  }

  return (
    <div className={styles.container}>
      {/* Кнопка закрытия */}
      <button className={styles.closeButton} onClick={handleClose}>✕</button>

      {/* Скроллируемый контент */}
      <div className={styles.content}>
        
        {/* БЛОК 1: Паспортные данные */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>ПАСПОРТНЫЕ ДАННЫЕ</h2>
          
          {/* Кнопка Госуслуги */}
          <button className={styles.gosuslugiButton}>
            <img src="/icons/logo_gosuslugi.png" alt="Госуслуги" className={styles.gosuslugiIcon} />
            <span>Заполнить через Госуслуги</span>
          </button>

          {/* Разделитель "или вручную" */}
          <div className={styles.divider}>
            <span>или вручную</span>
          </div>

          {/* Поля паспорта */}
          <input 
            type="text" 
            className={styles.input}
            placeholder="ФИО  полностью"
            value={formData.fullName}
            onChange={(e) => setFormData({...formData, fullName: e.target.value})}
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
        </section>

        {/* БЛОК 2: Фото паспорта */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>ФОТО ПАСПОРТА</h2>
          
          <div className={styles.photoRow}>
            <div className={styles.photoBox}>
              <p className={styles.photoLabel}>основной разворот</p>
              <button className={styles.addPhotoButton}>+ Добавить</button>
            </div>
            <div className={styles.photoBox}>
              <p className={styles.photoLabel}>регистрация</p>
              <button className={styles.addPhotoButton}>+ Добавить</button>
            </div>
          </div>
        </section>

        {/* БЛОК 3: Медицинская книжка */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>МЕДИЦИНСКАЯ КНИЖКА</h2>
          <p className={styles.hint}>
            Необходимо минимум 3 фото: личные данные, врачи/допуск, 
            аттестация о профессиональной гигиенической подготовке (ГИГ).
          </p>

          <div className={styles.medicalPhotos}>
            <div className={styles.medicalPhotoBox}>
              <span className={styles.addIcon}>+</span>
              <p className={styles.medicalLabel}>стр. 1</p>
            </div>
            <div className={styles.medicalPhotoBox}>
              <span className={styles.addIcon}>+</span>
              <p className={styles.medicalLabel}>стр. 2</p>
            </div>
            <div className={styles.medicalPhotoBox}>
              <span className={styles.addIcon}>+</span>
              <p className={styles.medicalLabel}>стр. 3+</p>
            </div>
          </div>

          <button className={styles.addMoreButton}>+ Добавить</button>
        </section>

        {/* БЛОК 4: Личная информация */}
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

        {/* БЛОК 5: Выплата чаевых */}
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
