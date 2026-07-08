import webpush from 'web-push'
import { config } from './config.js'
import { supabaseAdmin } from './supabase.js'

webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey)

// Рассылает push всем подпискам официанта(ов), кому адресован вызов.
// Целевого официанта уже вычислила call_waiter() в БД (waiter_calls.
// target_waiter_id) — get_call_target_waiters() разворачивает его в
// список id (один — для целевого вызова, несколько — для
// широковещательного, пусто — если вызов уже не 'pending').
export async function sendPushForCall(callId) {
  const { data: call, error: callError } = await supabaseAdmin
    .from('waiter_calls')
    .select('table_number')
    .eq('id', callId)
    .maybeSingle()
  if (callError || !call) return { sent: 0 }

  const { data: targets, error: targetsError } = await supabaseAdmin
    .rpc('get_call_target_waiters', { p_call_id: callId })
  if (targetsError || !targets?.length) return { sent: 0 }

  const waiterIds = targets.map((t) => t.waiter_id)
  const { data: subs, error: subsError } = await supabaseAdmin
    .from('waiter_push_subscriptions')
    .select('id, waiter_id, endpoint, p256dh, auth')
    .in('waiter_id', waiterIds)
  if (subsError || !subs?.length) return { sent: 0 }

  const payload = JSON.stringify({
    title: 'Вызов официанта',
    body: `Стол №${call.table_number}`,
    callId,
  })

  let sent = 0
  await Promise.all(
    subs.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }
      try {
        await webpush.sendNotification(pushSubscription, payload)
        sent += 1
      } catch (err) {
        // 404/410 — подписка больше не существует на стороне push-сервиса
        // (переустановка приложения, сброс разрешений и т.п.) — чистим,
        // иначе будем биться в неё при каждом следующем вызове.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabaseAdmin.from('waiter_push_subscriptions').delete().eq('id', sub.id)
        }
      }
    })
  )

  return { sent }
}
