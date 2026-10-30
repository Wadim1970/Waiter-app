// Залы ресторана (Основной зал, Веранда, ВИП…): restaurant_zones — ключ
// (его хранит tables.zone), название, порядок. Пока миграция
// 20261031010000_zones_staff не применена, залы берутся из столов со
// старыми названиями, а менять их нельзя.

import { deps, httpError } from './hallService.js'

export const DEFAULT_ZONE_NAMES = { main: 'Основной зал', veranda: 'Веранда', banquet: 'Банкетный зал' }

const missingTable = (e) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message || ''))
const NEED_MIGRATION = 'Чтобы добавлять и переименовывать залы, примените на сервере базы миграцию 20261031010000_zones_staff.sql'

async function zoneRows(restaurantId) {
  const { data, error } = await deps.db.from('restaurant_zones').select('id, key, name, sort_order')
    .eq('restaurant_id', restaurantId).order('sort_order')
  if (missingTable(error)) return null
  if (error) throw error
  return data || []
}

// Залы по порядку; залы, на которые ссылаются столы, но которых нет в
// списке (старые данные), — в конце, со старыми названиями.
export async function zonesOf(restaurantId, tables = []) {
  const rows = await zoneRows(restaurantId)
  const out = (rows || []).map((z) => ({ id: z.id, key: z.key, name: z.name, order: z.sort_order }))
  for (const key of new Set(tables.map((t) => t.zone || 'main'))) {
    if (!out.some((z) => z.key === key)) out.push({ id: null, key, name: DEFAULT_ZONE_NAMES[key] || key, order: 999 })
  }
  if (!out.length) out.push({ id: null, key: 'main', name: DEFAULT_ZONE_NAMES.main, order: 0 })
  return { zones: out, editable: rows !== null }
}

// Залы ещё не заведены (нет миграции или ресторан новый) — годятся прежние
// main / veranda / banquet.
export async function assertZone(restaurantId, key) {
  const rows = await zoneRows(restaurantId)
  const ok = rows?.length ? rows.some((z) => z.key === key) : !!DEFAULT_ZONE_NAMES[key]
  if (!ok) throw httpError(400, 'Такого зала нет')
}

async function editableRows(restaurantId) {
  const rows = await zoneRows(restaurantId)
  if (rows === null) throw httpError(409, NEED_MIGRATION)
  return rows
}

const cleanName = (v) => {
  const name = String(v || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  if (!name) throw httpError(400, 'Укажите название зала')
  return name
}

export async function createZone(restaurantId, body) {
  const rows = await editableRows(restaurantId)
  const name = cleanName(body.name)
  if (rows.some((z) => z.name.toLowerCase() === name.toLowerCase())) throw httpError(409, `Зал «${name}» уже есть`)
  // Ключ — латиницей и без смысла: название можно менять, ключ у столов остаётся.
  let key = `z${Date.now().toString(36)}`
  while (rows.some((z) => z.key === key)) key += 'x'
  const { data, error } = await deps.db.from('restaurant_zones')
    .insert({ restaurant_id: restaurantId, key, name, sort_order: Math.max(0, ...rows.map((z) => z.sort_order)) + 1 })
    .select('id, key').single()
  if (error) throw error
  return data
}

export async function updateZone(restaurantId, body) {
  const rows = await editableRows(restaurantId)
  if (Array.isArray(body.order)) {
    for (const [i, id] of body.order.entries()) {
      if (!rows.some((z) => z.id === id)) continue
      const { error } = await deps.db.from('restaurant_zones').update({ sort_order: i + 1 }).eq('id', id).eq('restaurant_id', restaurantId)
      if (error) throw error
    }
    return { ok: true }
  }
  const zone = rows.find((z) => z.id === body.id)
  if (!zone) throw httpError(404, 'Зал не найден')
  const name = cleanName(body.name)
  if (rows.some((z) => z.id !== zone.id && z.name.toLowerCase() === name.toLowerCase())) throw httpError(409, `Зал «${name}» уже есть`)
  const { error } = await deps.db.from('restaurant_zones').update({ name }).eq('id', zone.id).eq('restaurant_id', restaurantId)
  if (error) throw error
  return { ok: true }
}

// Удалить можно только зал без столов: столы сначала переносят в другой
// зал или убирают со схемы.
export async function deleteZone(restaurantId, id) {
  const rows = await editableRows(restaurantId)
  const zone = rows.find((z) => z.id === id)
  if (!zone) throw httpError(404, 'Зал не найден')
  if (rows.length <= 1) throw httpError(409, 'Это единственный зал — его нельзя удалить')
  const { data, error } = await deps.db.from('tables').select('id').eq('restaurant_id', restaurantId).eq('zone', zone.key).eq('is_active', true).limit(1)
  if (error) throw error
  if (data?.length) throw httpError(409, `В зале «${zone.name}» есть столы — перенесите их в другой зал или уберите со схемы`)
  const { error: delErr } = await deps.db.from('restaurant_zones').delete().eq('id', zone.id).eq('restaurant_id', restaurantId)
  if (delErr) throw delErr
  return { ok: true }
}
