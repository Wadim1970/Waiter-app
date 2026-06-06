import QRCode from 'qrcode'
import { supabase } from './supabase'

const APP_URL = import.meta.env.VITE_APP_URL ?? 'https://waiter-app-aa4d.vercel.app'

export async function getOrGenerateQR(restaurantId: string): Promise<string | null> {
  // 1. Получаем актуальный токен и данные ресторана
  const { data: tokenRow } = await supabase
    .from('restaurant_daily_tokens')
    .select('token, valid_date')
    .eq('restaurant_id', restaurantId)
    .eq('valid_date', new Date().toISOString().split('T')[0])
    .maybeSingle()

  if (!tokenRow) return null

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('qr_code_url, qr_last_generated_at, qr_reset_time')
    .eq('restaurantId', restaurantId)
    .maybeSingle()

  if (!restaurant) return null

  // 2. Проверяем нужно ли перегенерировать
  const needsRegen = shouldRegenerate(
    restaurant.qr_last_generated_at,
    restaurant.qr_reset_time
  )

  if (!needsRegen && restaurant.qr_code_url) {
    return restaurant.qr_code_url
  }

  // 3. Генерируем QR
  const qrUrl = `${APP_URL}/restaurant/scan?token=${tokenRow.token}`
  const pngDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 400,
    margin: 2,
    color: { dark: '#102A45', light: '#ffffff' },
  })

  // 4. Конвертируем dataURL → Blob
  const res = await fetch(pngDataUrl)
  const blob = await res.blob()

  // 5. Загружаем в Storage
  const filePath = `${restaurantId}.png`
  const { error: uploadError } = await supabase.storage
    .from('qr-codes')
    .upload(filePath, blob, {
      contentType: 'image/png',
      upsert: true,
    })

  if (uploadError) {
    console.error('Ошибка загрузки QR:', uploadError)
    return null
  }

  // 6. Получаем публичный URL
  const { data: publicUrl } = supabase.storage
    .from('qr-codes')
    .getPublicUrl(filePath)

  // 7. Сохраняем URL и время генерации в ресторане
  await supabase
    .from('restaurants')
    .update({
      qr_code_url: publicUrl.publicUrl,
      qr_last_generated_at: new Date().toISOString(),
    })
    .eq('restaurantId', restaurantId)

  return publicUrl.publicUrl
}

function shouldRegenerate(
  lastGeneratedAt: string | null,
  resetTime: string | null
): boolean {
  if (!lastGeneratedAt) return true

  const now = new Date()
  const last = new Date(lastGeneratedAt)

  // Если последняя генерация была не сегодня — перегенерируем
  if (last.toDateString() !== now.toDateString()) return true

  // Если время сброса уже наступило, а последняя генерация была до него — перегенерируем
  if (resetTime) {
    const [hours, minutes] = resetTime.split(':').map(Number)
    const resetToday = new Date(now)
    resetToday.setHours(hours, minutes, 0, 0)

    if (now >= resetToday && last < resetToday) return true
  }

  return false
}
