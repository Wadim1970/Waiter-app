import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import type { TableWithSession } from '../../../lib/tables'
import styles from './MenuScreen.module.css'

type MenuItem = {
  id: string
  name: string
  description: string
  price: number
  time: number
  subcategory_id: string
  image_url?: string
}

type MenuCategory = {
  id: string
  name: string
  slug: string
}

type MenuSubcategory = {
  id: string
  category_id: string
  name: string
}

type CartItem = {
  dishId: string
  quantity: number
  modifiers: Record<string, string[]>
}

const GUEST_COLORS = [
  '#02a826', '#ce00b9', '#ff9500', '#003daf',
  '#6c03ed', '#0f929c', '#700061', '#979200',
]

export default function MenuScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  const initialGuests = location.state?.guests || []

  const [activeGuest, setActiveGuest] = useState(0)
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [activeSubcategory, setActiveSubcategory] = useState<string>('')

  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [subcategories, setSubcategories] = useState<MenuSubcategory[]>([])
  const [dishes, setDishes] = useState<MenuItem[]>([])

  const [cart, setCart] = useState<Record<number, CartItem[]>>({})
  const [selectedDishForModifier, setSelectedDishForModifier] = useState<MenuItem | null>(null)
  const [selectedDishForInfo, setSelectedDishForInfo] = useState<MenuItem | null>(null)

  const touchStartRef = useRef(0)

  // Load menu data on mount
  useEffect(() => {
    const loadMenu = async () => {
      const { data: cats } = await supabase.from('menu_categories').select('*')
      if (cats) {
        setCategories(cats)
        setActiveCategory(cats[0]?.id || '')
      }
    }
    loadMenu()
  }, [])

  // Load subcategories when category changes
  useEffect(() => {
    const loadSubcategories = async () => {
      if (!activeCategory) return
      const { data: subs } = await supabase
        .from('menu_subcategories')
        .select('*')
        .eq('category_id', activeCategory)
      if (subs && subs.length > 0) {
        setSubcategories(subs)
        setActiveSubcategory(subs[0].id)
      } else {
        setSubcategories([])
        setActiveSubcategory('')
      }
    }
    loadSubcategories()
  }, [activeCategory])

  // Load dishes when subcategory changes
  useEffect(() => {
    const loadDishes = async () => {
      if (!activeCategory) return
      let query = supabase.from('menu_items').select('*').eq('category_id', activeCategory)
      if (activeSubcategory) {
        query = query.eq('subcategory_id', activeSubcategory)
      }
      const { data } = await query
      setDishes(data || [])
    }
    loadDishes()
  }, [activeCategory, activeSubcategory])

  const addToCart = (dish: MenuItem) => {
    // TODO: Check if dish has modifiers, if yes show modal
    const newCart = { ...cart }
    if (!newCart[activeGuest]) newCart[activeGuest] = []
    const existing = newCart[activeGuest].find(item => item.dishId === dish.id)
    if (existing) {
      existing.quantity += 1
    } else {
      newCart[activeGuest].push({ dishId: dish.id, quantity: 1, modifiers: {} })
    }
    setCart(newCart)
  }

  const removeFromCart = (dishId: string) => {
    const newCart = { ...cart }
    if (!newCart[activeGuest]) return
    const idx = newCart[activeGuest].findIndex(item => item.dishId === dishId)
    if (idx !== -1) {
      newCart[activeGuest][idx].quantity -= 1
      if (newCart[activeGuest][idx].quantity === 0) {
        newCart[activeGuest].splice(idx, 1)
      }
    }
    setCart(newCart)
  }

  const getQuantity = (dishId: string): number => {
    return cart[activeGuest]?.find(item => item.dishId === dishId)?.quantity || 0
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = e.touches[0].clientY
  }

  const handleTouchEnd = (e: React.TouchEvent, closeModal: () => void) => {
    const touchEnd = e.changedTouches[0].clientY
    if (touchEnd - touchStartRef.current > 100) {
      closeModal()
    }
  }

  return (
    <div className={styles.screen}>

      {/* ── Header + Guest bar (same as GuestDescriptionScreen) ── */}
      <div className={styles.headerZone}>
        <div className={styles.header}>
          <span className={styles.menuDecor}>МЕНЮ</span>
        </div>
        <div className={styles.guestBar}>
          {GUEST_COLORS.map((color, i) => {
            const qty = cart[i]?.reduce((sum, item) => sum + item.quantity, 0) || 0
            return (
              <button
                key={i}
                className={`${styles.guestCircle} ${activeGuest === i ? styles.guestCircleActive : ''}`}
                style={activeGuest === i ? { borderColor: color } : undefined}
                onClick={() => setActiveGuest(i)}
              >
                <span className={styles.guestLabel} style={{ color: activeGuest === i ? color : '#8e9096' }}>
                  <span className={styles.guestLabelG}>г</span>
                  <span className={styles.guestLabelN}>{i + 1}</span>
                </span>
                {qty > 0 && <span className={styles.cartBadge}>{qty}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Main categories (Еда, Напитки, Алкоголь) ── */}
      <div className={styles.mainCategories}>
        {categories.map(cat => (
          <button
            key={cat.id}
            className={`${styles.mainCatBtn} ${activeCategory === cat.id ? styles.mainCatBtnActive : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
        <div
          className={styles.mainCatBg}
          style={{
            opacity: activeCategory ? 0.3 : 0,
          }}
        />
      </div>

      {/* ── Subcategories (horizontal scroll) ── */}
      {subcategories.length > 0 && (
        <div className={styles.subcategoriesBar}>
          {subcategories.map(sub => (
            <button
              key={sub.id}
              className={`${styles.subCatBtn} ${activeSubcategory === sub.id ? styles.subCatBtnActive : ''}`}
              onClick={() => setActiveSubcategory(sub.id)}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Dishes list ── */}
      <div className={styles.content}>
        {dishes.map(dish => {
          const qty = getQuantity(dish.id)
          return (
            <div key={dish.id} className={styles.dishCard}>
              <div className={styles.dishLeft}>
                <h3 className={styles.dishName} onClick={() => setSelectedDishForInfo(dish)}>
                  {dish.name}
                </h3>
                <p className={styles.dishTime}>{dish.time} мин</p>
              </div>
              <div className={styles.dishRight}>
                <span className={styles.dishPrice}>{dish.price} руб</span>
                <div className={styles.dishActions}>
                  {qty === 0 ? (
                    <button className={styles.addBtn} onClick={() => addToCart(dish)}>+</button>
                  ) : (
                    <>
                      <button className={styles.minusBtn} onClick={() => removeFromCart(dish.id)}>−</button>
                      <span className={styles.qty}>{qty}</span>
                      <button className={styles.addBtn} onClick={() => addToCart(dish)}>+</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Right-edge СТОЛ tab ── */}
      <div className={styles.stolTab}>
        <span className={styles.stolTabText}>СТОЛ</span>
      </div>

      {/* ── К СТОЛУ button ── */}
      <div className={styles.footer}>
        <button className={styles.toTableBtn} onClick={() => navigate('/restaurant/tables')}>
          К СТОЛУ
        </button>
      </div>

      {/* ── Modifier modal (swipe down to close) ── */}
      {selectedDishForModifier && (
        <div
          className={styles.modalOverlay}
          onTouchStart={handleTouchStart}
          onTouchEnd={e => handleTouchEnd(e, () => setSelectedDishForModifier(null))}
        >
          <div className={styles.modal}>
            <h3>{selectedDishForModifier.name}</h3>
            {/* TODO: Render modifiers here */}
            <button onClick={() => setSelectedDishForModifier(null)}>Ок</button>
          </div>
        </div>
      )}

      {/* ── Dish info modal (swipe down to close) ── */}
      {selectedDishForInfo && (
        <div
          className={styles.modalOverlay}
          onTouchStart={handleTouchStart}
          onTouchEnd={e => handleTouchEnd(e, () => setSelectedDishForInfo(null))}
        >
          <div className={styles.modal}>
            <h3>{selectedDishForInfo.name}</h3>
            <p><strong>Описание:</strong></p>
            <p>{selectedDishForInfo.description}</p>
            {/* TODO: Состав, пищевая ценность */}
            <button onClick={() => setSelectedDishForInfo(null)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  )
}
