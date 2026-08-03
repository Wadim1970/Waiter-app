import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { TableWithSession } from '../../../lib/tables'
import { supabase } from '../../../lib/supabase'
import styles from './GuestCartsScreen.module.css'

type DraftModifier = { name: string; price_delta: number }
type DraftItem = {
  item_id: string
  dish_name: string
  image_url: string | null
  unit_price: number
  quantity: number
  comment: string | null
  modifiers: DraftModifier[]
}
type GuestCart = { seat_number: number; items: DraftItem[] }

const modSum = (mods: DraftModifier[]) => (mods || []).reduce((s, m) => s + (Number(m?.price_delta) || 0), 0)
const lineTotal = (it: DraftItem) => (Number(it.unit_price || 0) + modSum(it.modifiers)) * Number(it.quantity || 0)
const cartTotal = (items: DraftItem[]) => (items || []).reduce((s, it) => s + lineTotal(it), 0)

export default function GuestCartsScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const table = location.state?.table as TableWithSession | undefined
  const initial = (location.state?.drafts ?? []) as GuestCart[]

  const [carts, setCarts] = useState<GuestCart[]>(initial)
  const [loading, setLoading] = useState(false)

  // Realtime по черновикам нет — при входе (и по кнопке «обновить») перечитываем
  // текущее состояние корзин, чтобы официант видел свежие данные.
  const refresh = useCallback(async () => {
    if (!table?.id) return
    setLoading(true)
    const { data } = await supabase.rpc('get_table_cart_drafts', { p_table_id: table.id })
    if (Array.isArray(data)) setCarts(data as GuestCart[])
    setLoading(false)
  }, [table])

  useEffect(() => { refresh() }, [refresh])

  const grandTotal = carts.reduce((s, c) => s + cartTotal(c.items), 0)

  const [taking, setTaking] = useState<number | null>(null)

  // «Взять» корзину гостя: черновик материализуется в заказ (status 'new') и
  // открывается тот же редактируемый экран меню, что и когда официант сам
  // набирает корзину гостю (добавить/убрать/модификаторы/отправить на кухню).
  async function openGuest(seat: number) {
    if (!table?.id || taking !== null) return
    setTaking(seat)
    const { data, error } = await supabase.rpc('take_guest_cart', {
      p_table_id: table.id,
      p_seat_number: seat,
    })
    if (error) { setTaking(null); return }
    const orderId = Array.isArray(data)
      ? data[0]?.order_id
      : (data as { order_id?: string })?.order_id
    navigate('/restaurant/menu', { state: { table, orderId, activeGuestIndex: seat - 1 } })
  }

  return (
    <div className={styles.screen}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => navigate('/restaurant/tables')}>←</button>
        <h1 className={styles.title}>Стол {table?.number ?? ''}</h1>
        <button className={styles.refreshBtn} onClick={refresh} disabled={loading} aria-label="Обновить">⟳</button>
      </div>

      <div className={styles.subhead}>
        <span className={styles.guestCount}>Гостей: {carts.length}</span>
        <span className={styles.hint}>заказ ещё не отправлен на кухню</span>
      </div>

      <div className={styles.content}>
        {carts.length === 0 && (
          <p className={styles.empty}>Ни у кого пока ничего в корзине</p>
        )}

        {carts.map(cart => (
          <div key={cart.seat_number} className={styles.guestCard}>
            <div className={styles.guestHeader}>
              <span className={styles.guestName}>Гость {cart.seat_number}</span>
              <span className={styles.guestSum}>{cartTotal(cart.items)} ₽</span>
            </div>

            {cart.items.map((it, idx) => (
              <div key={`${it.item_id}-${idx}`} className={styles.itemRow}>
                {it.image_url
                  ? <img src={it.image_url} alt="" className={styles.itemImg} />
                  : <div className={styles.itemImgPlaceholder} />}
                <div className={styles.itemInfo}>
                  <div className={styles.itemName}>{it.dish_name}</div>
                  {it.modifiers?.length > 0 && (
                    <div className={styles.itemMods}>
                      {it.modifiers.map((m, i) => (
                        <span key={i} className={styles.itemMod}>
                          {m.name}{Number(m.price_delta) ? ` +${m.price_delta}₽` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                  {it.comment && <div className={styles.itemComment}>{it.comment}</div>}
                </div>
                <div className={styles.itemQtyPrice}>
                  <span className={styles.itemQty}>× {it.quantity}</span>
                  <span className={styles.itemPrice}>{lineTotal(it)} ₽</span>
                </div>
              </div>
            ))}

            <button
              className={styles.openBtn}
              onClick={() => openGuest(cart.seat_number)}
              disabled={taking !== null}
            >
              {taking === cart.seat_number ? 'Открываю…' : 'Открыть и дополнить →'}
            </button>
          </div>
        ))}
      </div>

      {carts.length > 0 && (
        <div className={styles.footer}>
          <span>Итого по столу</span>
          <span className={styles.grandTotal}>{grandTotal} ₽</span>
        </div>
      )}
    </div>
  )
}
