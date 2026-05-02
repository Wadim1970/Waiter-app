import styles from './RegistrationModal.module.css'

interface RegistrationModalProps {
  onContinue: () => void
  onCancel: () => void
}

export default function RegistrationModal({ onContinue, onCancel }: RegistrationModalProps) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        <h2 className={styles.title}>
          Для продолжения необходима полная регистрация.
        </h2>
        
        <p className={styles.description}>
          Заполните паспортные данные и все документы для доступа.
        </p>
        
        <div className={styles.buttons}>
          <button 
            className={styles.cancelButton}
            onClick={onCancel}
          >
            Отказаться
          </button>
          
          <button 
            className={styles.continueButton}
            onClick={onContinue}
          >
            ПРОДОЛЖИТЬ
          </button>
        </div>
      </div>
    </div>
  )
}
