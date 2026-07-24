import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase, supabaseRestaurants } from '../../../lib/supabase'
import { getActiveShift } from '../QRScanner/QRScannerScreen'
import { getOrCreateOrder, addOrderItem, removeOrderItem, loadOrderItems } from '../../../lib/orders'
import type { TableWithSession } from '../../../lib/tables'
import styles from './MenuScreen.module.css'

type MenuSection = { id: string; name: string; sort_order: number }
type MenuSubsection = { id: string; section_id: string; name: string; sort_order: number }
type MenuSubSubsection = { id: string; subsection_id: string; name: string; sort_order: number }

type MenuItem = {
  id: string
  dish_name: string
  description: string
  cost_rub: number
  cook_time_min: number
  weight_g: number
  nutritional_info: { calories?: number; proteins?: number; fats?: number; carbs?: number } | null
  ingredients: string | string[]
  image_url: string | null
  section_id: string
  subsection_id: string | null
  sub_subsection_id: string | null
  is_available: boolean
}

type ModifierGroup = { id: string; name: string; type: string; required: boolean }
type Modifier = { id: string; group_id: string; name: string; price_delta: number }

type CartItem = {
  dbId: string
  itemId: string
  quantity: number
  modifierNames: string[]
}

export default function MenuScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  const orderId = location.state?.orderId as string | undefined
  const activeGuestIndex = (location.state?.activeGuestIndex ?? 0) as number

  const [sections, setSections] = useState<MenuSection[]>([])
  const [subsections, setSubsections] = useState<MenuSubsection[]>([])
  const [subSubsections, setSubSubsections] = useState<MenuSubSubsection[]>([])
  const [dishes, setDishes] = useState<MenuItem[]>([])

  const [activeSectionId, setActiveSectionId] = useState<string>('')
  const [activeSubsectionId, setActiveSubsectionId] = useState<string>('all')
  const [activeSubSubsectionId, setActiveSubSubsectionId] = useState<string>('all')

  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([])
  const [modifiers, setModifiers] = useState<Modifier[]>([])
  const [pendingDish, setPendingDish] = useState<MenuItem | null>(null)
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string>>({})
  const [modifierComment, setModifierComment] = useState('')

  const [infoDish, setInfoDish] = useState<MenuItem | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [currentOrderId, setCurrentOrderId] = useState<string | null>(orderId ?? null)
  // restaurantId берём из активной смены; если её нет (напр. переход по
  // прямой ссылке без старта смены) — резолвим из стола (эффект ниже),
  // иначе menu_sections по пустому restaurant_id вернёт 0 и меню будет пустым.
  const [restaurantId, setRestaurantId] = useState<string>(getActiveShift()?.restaurantId ?? '')

  const touchStartY = useRef(0)
  const touchStartX = useRef(0)
  // Касание, начавшееся на горизонтальной ленте вкладок, — это её скролл,
  // а не свайп-возврат со всего экрана (см. handleScreenSwipeEnd).
  const swipeFromBar = useRef(false)

  // Фолбэк restaurantId: активной смены может не быть (переход по прямой
  // ссылке без старта смены) — тогда достаём ресторан из стола по id, иначе
  // разделы/блюда меню не загрузятся ("Блюда не найдены").
  useEffect(() => {
    if (restaurantId || !table?.id) return
    supabase
      .from('tables')
      .select('restaurant_id')
      .eq('id', table.id)
      .single()
      .then(({ data }) => { if (data?.restaurant_id) setRestaurantId(data.restaurant_id) })
  }, [table, restaurantId])

  // Ensure order exists; create if missing
  useEffect(() => {
    if (currentOrderId || !table || !restaurantId) return
    getOrCreateOrder(table.id, table.number, restaurantId)
      .then(id => setCurrentOrderId(id))
      .catch(err => console.error('getOrCreateOrder failed:', err))
  }, [table, currentOrderId, restaurantId])

  // Load existing cart for this guest from DB
  useEffect(() => {
    if (!currentOrderId) return
    loadOrderItems(currentOrderId).then(items => {
      const guestItems = items.filter(i => i.seat_number === activeGuestIndex + 1)
      setCart(guestItems.map(i => ({
        dbId: i.id,
        itemId: i.item_id,
        quantity: i.quantity,
        modifierNames: i.modifiers.map(m => m.name),
      })))
    })
  }, [currentOrderId, activeGuestIndex])

  // Load sections
  useEffect(() => {
    if (!restaurantId) return
    supabaseRestaurants
      .from('menu_sections')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('sort_order')
      .then(({ data }) => {
        if (data && data.length > 0) {
          setSections(data)
          setActiveSectionId(data[0].id)
        }
      })
  }, [restaurantId])

  // Load subsections when section changes
  useEffect(() => {
    if (!activeSectionId) return
    supabaseRestaurants
      .from('menu_subsections')
      .select('*')
      .eq('section_id', activeSectionId)
      .order('sort_order')
      .then(({ data }) => {
        setSubsections(data || [])
        setActiveSubsectionId('all')
        setSubSubsections([])
        setActiveSubSubsectionId('all')
      })
  }, [activeSectionId])

  // Load sub-subsections when subsection changes
  useEffect(() => {
    setActiveSubSubsectionId('all')
    if (!activeSubsectionId || activeSubsectionId === 'all') {
      setSubSubsections([])
      return
    }
    supabaseRestaurants
      .from('menu_sub_subsections')
      .select('*')
      .eq('subsection_id', activeSubsectionId)
      .order('sort_order')
      .then(({ data }) => setSubSubsections(data || []))
  }, [activeSubsectionId])

  // Load dishes
  useEffect(() => {
    if (!activeSectionId) return
    let query = supabaseRestaurants
      .from('menu_items')
      .select('*')
      .eq('section_id', activeSectionId)
      .eq('is_available', true)
      .order('sort_order')

    if (activeSubsectionId !== 'all') query = query.eq('subsection_id', activeSubsectionId)
    if (activeSubSubsectionId !== 'all') query = query.eq('sub_subsection_id', activeSubSubsectionId)

    query.then(({ data }) => setDishes(data || []))
  }, [activeSectionId, activeSubsectionId, activeSubSubsectionId])

  const handleAdd = async (dish: MenuItem) => {
    const { data: groups } = await supabaseRestaurants
      .from('modifier_groups')
      .select('*')
      .eq('item_id', dish.id)
      .order('sort_order')

    if (groups && groups.length > 0) {
      const { data: mods } = await supabaseRestaurants
        .from('modifiers')
        .select('*')
        .in('group_id', groups.map((g: ModifierGroup) => g.id))
        .eq('is_available', true)
        .order('sort_order')

      setModifierGroups(groups)
      setModifiers(mods || [])
      setSelectedModifiers({})
      setModifierComment('')
      setPendingDish(dish)
    } else {
      await addToCart(dish, {})
    }
  }

  const addToCart = async (dish: MenuItem, mods: Record<string, string>) => {
    if (!currentOrderId) return

    const modifiersList = Object.entries(mods)
      .filter(([, modId]) => modId)
      .map(([, modId]) => ({
        modifierId: modId,
        priceDelta: modifiers.find(m => m.id === modId)?.price_delta ?? 0,
      }))

    const modifierNames = Object.entries(mods)
      .filter(([, modId]) => modId)
      .map(([, modId]) => modifiers.find(m => m.id === modId)?.name ?? '')
      .filter(Boolean)

    const dbId = await addOrderItem(currentOrderId, dish.id, activeGuestIndex + 1, dish.cost_rub, modifiersList, modifierComment || undefined)

    setCart(prev => {
      if (modifiersList.length === 0) {
        const existing = prev.find(i => i.itemId === dish.id && i.modifierNames.length === 0)
        if (existing) {
          return prev.map(i => i.dbId === existing.dbId ? { ...i, dbId, quantity: i.quantity + 1 } : i)
        }
      }
      return [...prev, { dbId, itemId: dish.id, quantity: 1, modifierNames }]
    })
    setPendingDish(null)
  }

  const removeFromCart = async (dishId: string) => {
    const item = cart.find(i => i.itemId === dishId)
    if (!item) return
    await removeOrderItem(item.dbId, item.quantity)
    setCart(prev => {
      const idx = prev.findIndex(i => i.dbId === item.dbId)
      if (idx === -1) return prev
      const next = [...prev]
      if (next[idx].quantity > 1) {
        next[idx] = { ...next[idx], quantity: next[idx].quantity - 1 }
      } else {
        next.splice(idx, 1)
      }
      return next
    })
  }

  const getQuantity = (dishId: string) =>
    cart.filter(i => i.itemId === dishId).reduce((sum, i) => sum + i.quantity, 0)

  const handleModalSwipe = (e: React.TouchEvent, close: () => void) => {
    if (e.changedTouches[0].clientY - touchStartY.current > 80) close()
  }

  const handleScreenSwipeEnd = (e: React.TouchEvent) => {
    // Свайп по ленте вкладок = горизонтальный скролл ленты, а не возврат
    // со всего экрана. Не даём такому жесту сработать как навигация.
    if (swipeFromBar.current) { swipeFromBar.current = false; return }
    const dx = e.changedTouches[0].clientX - touchStartX.current
    if (dx > 80) goToOrder()
  }

  const goToOrder = () => {
    navigate(`/restaurant/table/${table?.id ?? ''}/order`, {
      state: { table, guests: location.state?.guests, orderId: currentOrderId, activeGuestIndex }
    })
  }

  const activeSection = sections.find(s => s.id === activeSectionId)
  const showVolume = activeSection?.name === 'Напитки' || activeSection?.name === 'Алкоголь'
  const hasSubSubsections = subSubsections.length > 0
  const contentTop = 164 + (hasSubSubsections ? 52 + 4 : 0)

  return (
    <div
      className={styles.screen}
      onTouchStart={e => {
        touchStartX.current = e.touches[0].clientX
        // Лента вкладок (подразделы/под-подразделы) помечена data-hscroll:
        // жест по ней — её скролл, экран не свайпаем.
        swipeFromBar.current = !!(e.target as HTMLElement)?.closest?.('[data-hscroll]')
      }}
      onTouchEnd={handleScreenSwipeEnd}
    >

      {/* ── Header: decorative МЕНЮ + sections ── */}
      <div className={styles.header}>
        <span className={styles.menuDecor}>МЕНЮ</span>
        <div className={styles.sectionsRow}>
          {sections.map(sec => (
            <button
              key={sec.id}
              className={`${styles.sectionBtn} ${activeSectionId === sec.id ? styles.sectionBtnActive : ''}`}
              onClick={() => setActiveSectionId(sec.id)}
            >
              {sec.name}
            </button>
          ))}
        </div>
      </div>

      {/* ── Subsections ── */}
      {subsections.length > 0 && (
        <div className={styles.subsectionsBar} data-hscroll>
          <button
            className={`${styles.subBtn} ${activeSubsectionId === 'all' ? styles.subBtnActive : ''}`}
            onClick={() => setActiveSubsectionId('all')}
          >
            Все
          </button>
          {subsections.map(sub => (
            <button
              key={sub.id}
              className={`${styles.subBtn} ${activeSubsectionId === sub.id ? styles.subBtnActive : ''}`}
              onClick={() => setActiveSubsectionId(sub.id)}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Sub-subsections ── */}
      {hasSubSubsections && (
        <div className={styles.subSubsectionsBar} data-hscroll>
          <button
            className={`${styles.subSubBtn} ${activeSubSubsectionId === 'all' ? styles.subSubBtnActive : ''}`}
            onClick={() => setActiveSubSubsectionId('all')}
          >
            Все
          </button>
          {subSubsections.map(sub => (
            <button
              key={sub.id}
              className={`${styles.subSubBtn} ${activeSubSubsectionId === sub.id ? styles.subSubBtnActive : ''}`}
              onClick={() => setActiveSubSubsectionId(sub.id)}
            >
              {sub.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Dishes ── */}
      <div className={styles.content} style={{ marginTop: contentTop }}>
        {dishes.length === 0 && (
          <p className={styles.empty}>Блюда не найдены</p>
        )}
        {dishes.map(dish => {
          const qty = getQuantity(dish.id)
          return (
            <div key={dish.id} className={styles.dishRow}>
              <div className={styles.dishLeft}>
                <p className={styles.dishName} onClick={() => setInfoDish(dish)}>
                  {dish.dish_name}
                </p>
                <p className={styles.dishTime}>
                  {showVolume ? dish.weight_g : `${dish.cook_time_min} мин`}
                </p>
              </div>
              <div className={styles.dishRight}>
                <span className={styles.dishPrice}>{dish.cost_rub} руб</span>
                <div className={styles.dishActions}>
                  {qty === 0 ? (
                    <button className={styles.addBtn} onClick={() => handleAdd(dish)}>+</button>
                  ) : (
                    <div className={styles.counter}>
                      <button className={styles.minusBtn} onClick={() => removeFromCart(dish.id)}>−</button>
                      <span className={styles.qty}>{qty}</span>
                      <button className={styles.addBtn} onClick={() => handleAdd(dish)}>+</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Left СТОЛ tab ── */}
      <div className={styles.stolTab} onClick={() => navigate('/restaurant/tables')}>
        <span className={styles.stolTabText}>СТОЛ</span>
      </div>

      {/* ── К СТОЛУ button ── */}
      <div className={styles.footer}>
        <button className={styles.toTableBtn} onClick={goToOrder}>К СТОЛУ</button>
      </div>

      {/* ── Modifier modal ── */}
      {pendingDish && (
        <div
          className={styles.overlay}
          onTouchStart={e => { touchStartY.current = e.touches[0].clientY }}
          onTouchEnd={e => handleModalSwipe(e, () => setPendingDish(null))}
          onClick={e => e.target === e.currentTarget && setPendingDish(null)}
        >
          <div className={styles.modal}>
            <div className={styles.modalHandle} />
            {modifierGroups.map(group => (
              <div key={group.id} className={styles.modGroup}>
                <div className={styles.modGroupHeader}>
                  <div className={styles.modGroupLine} />
                  <span className={styles.modGroupName}>{group.name}</span>
                  <div className={styles.modGroupLine} />
                </div>
                <div className={styles.modTags}>
                  {modifiers.filter(m => m.group_id === group.id).map(mod => (
                    <button
                      key={mod.id}
                      className={`${styles.modTag} ${selectedModifiers[group.id] === mod.id ? styles.modTagActive : ''}`}
                      onClick={() => setSelectedModifiers(prev => ({
                        ...prev,
                        [group.id]: prev[group.id] === mod.id ? '' : mod.id
                      }))}
                    >
                      {mod.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <textarea
              className={styles.commentInput}
              placeholder="Комментарий (не обязательно)"
              value={modifierComment}
              onChange={e => setModifierComment(e.target.value)}
            />
            <button
              className={styles.okBtn}
              onClick={() => addToCart(pendingDish, selectedModifiers)}
            >
              Ок
            </button>
          </div>
        </div>
      )}

      {/* ── Dish info modal ── */}
      {infoDish && (
        <div
          className={styles.overlay}
          onTouchStart={e => { touchStartY.current = e.touches[0].clientY }}
          onTouchEnd={e => handleModalSwipe(e, () => setInfoDish(null))}
          onClick={e => e.target === e.currentTarget && setInfoDish(null)}
        >
          <div className={styles.modal}>
            <div className={styles.modalHandle} />
            <InfoSection title="Описание">
              <p className={styles.infoText}>{infoDish.description}</p>
            </InfoSection>
            {infoDish.ingredients && (
              <InfoSection title="Состав">
                <p className={styles.infoText}>
                  {(() => {
                    try {
                      const arr = typeof infoDish.ingredients === 'string'
                        ? JSON.parse(infoDish.ingredients)
                        : infoDish.ingredients
                      return Array.isArray(arr)
                        ? arr.map((s: string) => s.charAt(0).toUpperCase() + s.slice(1)).join(', ')
                        : String(infoDish.ingredients)
                    } catch {
                      return String(infoDish.ingredients)
                    }
                  })()}
                </p>
              </InfoSection>
            )}
            {infoDish.nutritional_info && (
              <InfoSection title="Пищевая ценность">
                <div className={styles.nutrition}>
                  <NutrCell value={infoDish.nutritional_info.calories} label="ккал" />
                  <NutrCell value={infoDish.nutritional_info.proteins} label="белки" />
                  <NutrCell value={infoDish.nutritional_info.fats} label="жиры" />
                  <NutrCell value={infoDish.nutritional_info.carbs} label="углеводы" />
                </div>
              </InfoSection>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
        <span style={{ fontFamily: 'Montserrat, sans-serif', fontWeight: 600, fontSize: 14, color: '#000' }}>{title}</span>
        <div style={{ flex: 1, height: 1, background: '#e0e0e0' }} />
      </div>
      {children}
    </div>
  )
}

function NutrCell({ value, label }: { value?: number; label: string }) {
  if (value == null) return null
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'Montserrat, sans-serif', fontWeight: 700, fontSize: 16 }}>{value.toFixed(2)}</div>
      <div style={{ fontFamily: 'Montserrat, sans-serif', fontSize: 12, color: '#999' }}>{label}</div>
    </div>
  )
}
