import { useRef, useState } from 'react'
import styles from './ImagePreview.module.css'

interface ImagePreviewProps {
  file: File | null
  onAdd: (file: File) => void
  onRemove: () => void
  alt: string
  label?: string
}

export default function ImagePreview({ file, onAdd, onRemove, alt, label }: ImagePreviewProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const objectUrl = file ? URL.createObjectURL(file) : null

  const handleSlotClick = () => {
    if (!file) {
      inputRef.current?.click()
    } else {
      setIsModalOpen(true)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      onAdd(selected)
    }
    // Reset input so same file can be re-selected after removal
    e.target.value = ''
  }

  const handleRemoveClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowConfirm(true)
  }

  const handleConfirmRemove = () => {
    setShowConfirm(false)
    setIsModalOpen(false)
    onRemove()
  }

  const handleCancelRemove = () => {
    setShowConfirm(false)
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      <div className={styles.slot} onClick={handleSlotClick}>
        {!file ? (
          <>
            {label && <p className={styles.slotLabel}>{label}</p>}
            <span className={styles.addText}>+ Добавить</span>
          </>
        ) : (
          <>
            <img src={objectUrl!} alt={alt} className={styles.thumbnailImg} />
            <button className={styles.removeBtn} onClick={handleRemoveClick}>✕</button>
          </>
        )}
      </div>

      {/* Полноэкранная модалка */}
      {isModalOpen && file && (
        <div className={styles.modal} onClick={() => setIsModalOpen(false)}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <button className={styles.closeBtn} onClick={() => setIsModalOpen(false)}>✕ Закрыть</button>
            <img src={objectUrl!} alt={alt} className={styles.fullImg} />
            <button className={styles.deleteBtn} onClick={handleRemoveClick}>Удалить</button>
          </div>
        </div>
      )}

      {/* Диалог подтверждения удаления */}
      {showConfirm && (
        <div className={styles.confirmOverlay} onClick={e => e.stopPropagation()}>
          <div className={styles.confirmBox}>
            <p className={styles.confirmText}>Вы действительно хотите удалить фото?</p>
            <div className={styles.confirmButtons}>
              <button className={styles.confirmYes} onClick={handleConfirmRemove}>Да</button>
              <button className={styles.confirmNo} onClick={handleCancelRemove}>Нет</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
