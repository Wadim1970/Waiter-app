import styles from './RestaurantAccessDeniedModal.module.css'

interface RestaurantAccessDeniedModalProps {
  onClose: () => void
}

export default function RestaurantAccessDeniedModal({ onClose }: RestaurantAccessDeniedModalProps) {
  return (
    <div className={styles.modalOverlay}>
      <div className={styles.modalBox}>
        <h2 className={styles.title}>Доступ закрыт</h2>

        <p className={styles.description}>
          У вас нет подтверждённой смены в этом ресторане на сегодня.
          Проверьте раздел «Мои смены» или обратитесь к администратору.
        </p>

        <button className={styles.actionButton} onClick={onClose}>
          Сканировать другой QR
        </button>
      </div>
    </div>
  )
}
