// Раздел «Меню» в админке — чтение и запись (под service_role). Логика —
// menuCore.js. Пишем сразу так, чтобы меню совпадало у гостя (menu_section,
// section_order) и у официанта (дерево разделов, section_id…).

import crypto from 'node:crypto'
import { deps, selectAll, selectIn, restaurantOf, groupBy, httpError } from './hallService.js'
import {
  dishView, dishFields, sharedOf, popularTwins, sectionsOf, orderNumbers, isPopular, norm, decodeImage,
  PRODUCT_TYPES, COURSE_ROLES, MEAL_TIMES, WEIGHT_UNITS,
} from './menuCore.js'

const COLS = 'id, dish_name, menu_section, section_order, cost_rub, product_type, weight_g, specific_details, cook_time_min, description, ingredients, nutritional_info, tags, image_url, image_url_thumbnail, is_hidden, is_available, stop_until, course_role, meal_times, section_id, subsection_id, sub_subsection_id'

const isFkError = (e) => e && (e.code === '23503' || /foreign key/i.test(e.message || ''))

async function rowsOf(restaurantId) {
  return selectAll(() => deps.db.from('menu_items').select(COLS).eq('restaurant_id', restaurantId)
    .order('section_order', { ascending: true }).order('dish_name', { ascending: true }))
}

// Дерево разделов приложения официанта.
async function treeOf(restaurantId) {
  const sections = await selectAll(() => deps.db.from('menu_sections').select('id, name, sort_order').eq('restaurant_id', restaurantId).order('sort_order'))
  const subs = await selectIn('menu_subsections', 'id, section_id, name, sort_order', 'section_id', sections.map((s) => s.id))
  const subsubs = await selectIn('menu_sub_subsections', 'id, subsection_id, name, sort_order', 'subsection_id', subs.map((s) => s.id))
  const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name), 'ru')
  const subsOf = groupBy(subs, 'section_id')
  const subsubsOf = groupBy(subsubs, 'subsection_id')
  return sections.sort(bySort).map((s) => ({
    id: s.id,
    name: s.name,
    children: (subsOf.get(s.id) || []).sort(bySort).map((x) => ({
      id: x.id,
      name: x.name,
      children: (subsubsOf.get(x.id) || []).sort(bySort).map((y) => ({ id: y.id, name: y.name })),
    })),
  }))
}

async function modifiersOf(dishIds) {
  const groups = await selectIn('modifier_groups', 'id, item_id, name, type, required, sort_order', 'item_id', dishIds)
  const mods = groupBy(await selectIn('modifiers', 'id, group_id, name, price_delta, is_available, sort_order', 'group_id', groups.map((g) => g.id)), 'group_id')
  const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  return groupBy(groups.sort(byOrder).map((g) => ({
    itemId: g.item_id,
    id: g.id,
    name: g.name,
    type: g.type === 'multi' ? 'multi' : 'single',
    required: !!g.required,
    options: (mods.get(g.id) || []).sort(byOrder).map((m) => ({ id: m.id, name: m.name, priceDelta: m.price_delta || 0, available: m.is_available !== false })),
  })), 'itemId')
}

// Всё меню: разделы по порядку, блюда, добавки, дерево официанта.
export async function getMenu(restaurantId) {
  const restaurant = await restaurantOf(restaurantId)
  const [rows, tree] = await Promise.all([rowsOf(restaurantId), treeOf(restaurantId)])
  const mods = await modifiersOf(rows.map((r) => r.id))
  const twins = popularTwins(rows)
  const now = deps.now()
  return {
    restaurant,
    sections: sectionsOf(rows),
    dishes: rows.map((r) => dishView(r, {
      now,
      modifiers: (mods.get(r.id) || []).map(({ itemId, ...g }) => g),
      popularTwinId: twins.get(r.id) || null,
    })),
    tree,
    options: { productTypes: PRODUCT_TYPES, courseRoles: COURSE_ROLES, mealTimes: MEAL_TIMES, weightUnits: WEIGHT_UNITS },
  }
}

async function dishOf(restaurantId, id) {
  const { data, error } = await deps.db.from('menu_items').select(COLS).eq('id', id).eq('restaurant_id', restaurantId).maybeSingle()
  if (error) throw error
  if (!data) throw httpError(404, 'Блюдо не найдено')
  return data
}

async function update(restaurantId, ids, fields) {
  if (!ids.length || !Object.keys(fields).length) return
  const { error } = await deps.db.from('menu_items').update(fields).in('id', ids).eq('restaurant_id', restaurantId)
  if (error) throw error
}

// Место у официанта: раздел дерева ресторана (обязателен, если дерево есть).
// subsectionId 'new' — завести подраздел с названием гостевого раздела
// (для нового раздела меню).
async function placeFields(restaurantId, place, sectionName) {
  const tree = await treeOf(restaurantId)
  if (!tree.length) return { section_id: null, subsection_id: null, sub_subsection_id: null }
  const sec = tree.find((s) => s.id === place?.sectionId)
  if (!sec) throw httpError(400, 'Выберите, где блюдо будет у официанта: Еда, Напитки…')
  let subId = place.subsectionId || null
  if (subId === 'new') {
    const existing = sec.children.find((x) => norm(x.name) === norm(sectionName))
    if (existing) subId = existing.id
    else {
      const sort = sec.children.length + 1
      const { data, error } = await deps.db.from('menu_subsections').insert({ section_id: sec.id, name: sectionName, sort_order: sort }).select('id').single()
      if (error) throw error
      subId = data.id
    }
    return { section_id: sec.id, subsection_id: subId, sub_subsection_id: null }
  }
  const sub = subId ? sec.children.find((x) => x.id === subId) : null
  if (subId && !sub) throw httpError(400, 'Подраздел у официанта не найден')
  const subsubId = place.subSubsectionId || null
  if (subsubId && !sub?.children.some((y) => y.id === subsubId)) throw httpError(400, 'Группа у официанта не найдена')
  return { section_id: sec.id, subsection_id: sub?.id || null, sub_subsection_id: subsubId }
}

// Раздел блюда: существующий — его номер по порядку; новый — встаёт на место
// из sectionsOrder (полный список разделов в новом порядке), остальные
// разделы перенумеровываются.
async function sectionFields(restaurantId, rows, name, sectionsOrder) {
  const section = String(name || '').trim().slice(0, 100)
  if (!section) throw httpError(400, 'Укажите раздел меню')
  const same = rows.find((r) => norm(r.menu_section) === norm(section))
  if (same) return { menu_section: same.menu_section, section_order: same.section_order }
  const numbers = orderNumbers(sectionsOrder?.length ? sectionsOrder : [...sectionsOf(rows).map((s) => s.name), section], sectionsOf(rows))
  if (!numbers.has(section)) numbers.set(section, numbers.size + 1)
  await renumber(restaurantId, rows, numbers)
  return { menu_section: section, section_order: numbers.get(section) }
}

async function renumber(restaurantId, rows, numbers) {
  const bySection = groupBy(rows, 'menu_section')
  for (const [name, list] of bySection) {
    const n = numbers.get(name)
    if (n == null) continue
    const ids = list.filter((r) => r.section_order !== n).map((r) => r.id)
    await update(restaurantId, ids, { section_order: n })
  }
}

// Добавки блюда: группы и варианты по id; убранные — удаляем, а если их уже
// заказывали (на них ссылаются старые заказы) — выключаем.
async function saveModifiers(dishId, groups) {
  if (!Array.isArray(groups)) return
  const cur = await selectAll(() => deps.db.from('modifier_groups').select('id').eq('item_id', dishId))
  const curMods = await selectIn('modifiers', 'id, group_id', 'group_id', cur.map((g) => g.id))
  const keepGroups = new Set()
  const keepMods = new Set()
  for (const [gi, g] of groups.entries()) {
    const name = String(g?.name || '').trim().slice(0, 100)
    if (!name) continue
    const fields = { item_id: dishId, name, type: g.type === 'multi' ? 'multi' : 'single', required: !!g.required, sort_order: gi }
    let groupId = cur.some((c) => c.id === g.id) ? g.id : null
    if (groupId) {
      const { error } = await deps.db.from('modifier_groups').update(fields).eq('id', groupId)
      if (error) throw error
    } else {
      const { data, error } = await deps.db.from('modifier_groups').insert(fields).select('id').single()
      if (error) throw error
      groupId = data.id
    }
    keepGroups.add(groupId)
    for (const [oi, o] of (Array.isArray(g.options) ? g.options : []).entries()) {
      const oname = String(o?.name || '').trim().slice(0, 100)
      if (!oname) continue
      const delta = Math.round(Number(o.priceDelta) || 0)
      const mf = { group_id: groupId, name: oname, price_delta: delta, is_available: o.available !== false, sort_order: oi }
      if (curMods.some((m) => m.id === o.id)) {
        const { error } = await deps.db.from('modifiers').update(mf).eq('id', o.id)
        if (error) throw error
        keepMods.add(o.id)
      } else {
        const { error } = await deps.db.from('modifiers').insert(mf)
        if (error) throw error
      }
    }
  }
  for (const m of curMods.filter((x) => !keepMods.has(x.id) && keepGroups.has(x.group_id))) {
    const { error } = await deps.db.from('modifiers').delete().eq('id', m.id)
    if (isFkError(error)) await deps.db.from('modifiers').update({ is_available: false }).eq('id', m.id)
    else if (error) throw error
  }
  for (const g of cur.filter((x) => !keepGroups.has(x.id))) {
    const { error } = await deps.db.from('modifier_groups').delete().eq('id', g.id)
    if (isFkError(error)) await deps.db.from('modifiers').update({ is_available: false }).eq('group_id', g.id)
    else if (error) throw error
  }
}

// Копия блюда в «Популярном»: включить — завести строку там, выключить —
// убрать (если её уже заказывали — скрыть).
async function setPopular(restaurantId, rows, dishId, on) {
  const all = rows.length ? rows : await rowsOf(restaurantId)
  const dish = all.find((r) => r.id === dishId)
  if (!dish || isPopular(dish.menu_section)) return
  const twinId = popularTwins(all).get(dishId)
  if (on && !twinId) {
    const pop = sectionsOf(all).find((s) => isPopular(s.name))
    if (!pop) return
    const { id, menu_section, section_order, section_id, subsection_id, sub_subsection_id, stop_until, is_hidden, ...rest } = dish
    const { error } = await deps.db.from('menu_items').insert({
      ...rest, restaurant_id: restaurantId, menu_section: pop.name, section_order: pop.order, is_hidden: false,
      section_id: pop.place.sectionId, subsection_id: pop.place.subsectionId, sub_subsection_id: pop.place.subSubsectionId,
    })
    if (error) throw error
  } else if (!on && twinId) {
    const { error } = await deps.db.from('menu_items').delete().eq('id', twinId).eq('restaurant_id', restaurantId)
    if (isFkError(error)) await update(restaurantId, [twinId], { is_hidden: true })
    else if (error) throw error
  }
}

export async function createDish(restaurantId, body) {
  const fields = dishFields(body)
  const rows = await rowsOf(restaurantId)
  const section = await sectionFields(restaurantId, rows, body.section, body.sectionsOrder)
  const place = await placeFields(restaurantId, body.place, section.menu_section)
  const { data, error } = await deps.db.from('menu_items')
    .insert({ ...fields, ...section, ...place, restaurant_id: restaurantId }).select('id').single()
  if (error) throw error
  await saveModifiers(data.id, body.modifiers)
  if (body.inPopular) await setPopular(restaurantId, [], data.id, true)
  return { id: data.id }
}

export async function updateDish(restaurantId, id, body) {
  const cur = await dishOf(restaurantId, id)
  const fields = dishFields(body)
  const rows = await rowsOf(restaurantId)
  const section = await sectionFields(restaurantId, rows, body.section, body.sectionsOrder)
  const place = await placeFields(restaurantId, body.place, section.menu_section)
  const twinId = popularTwins(rows).get(id)
  await update(restaurantId, [id], { ...fields, ...section, ...place })
  // Копия в «Популярном» — то же блюдо: цена, состав, фото — одинаковые.
  if (twinId) await update(restaurantId, [twinId], sharedOf(fields))
  await saveModifiers(id, body.modifiers)
  if (typeof body.inPopular === 'boolean' && !isPopular(cur.menu_section)) await setPopular(restaurantId, [], id, body.inPopular)
  return { id }
}

export async function deleteDish(restaurantId, id) {
  await dishOf(restaurantId, id)
  const { error } = await deps.db.from('menu_items').delete().eq('id', id).eq('restaurant_id', restaurantId)
  if (isFkError(error)) throw httpError(409, 'Это блюдо уже заказывали — удалить его нельзя, иначе пропадёт история заказов. Скройте его из меню.')
  if (error) throw error
  return { id }
}

// Разделы: порядок, переименование, перенос блюд, удаление пустого.
export async function sectionAction(restaurantId, body) {
  const rows = await rowsOf(restaurantId)
  const sections = sectionsOf(rows)
  const find = (name) => sections.find((s) => s.name === name)
  switch (body.op) {
    case 'order':
      await renumber(restaurantId, rows, orderNumbers(body.order, sections))
      return { ok: true }
    case 'rename': {
      const from = find(body.name)
      const to = String(body.to || '').trim().slice(0, 100)
      if (!from) throw httpError(404, 'Раздел не найден')
      if (!to) throw httpError(400, 'Укажите новое название')
      if (sections.some((s) => s !== from && norm(s.name) === norm(to))) throw httpError(409, `Раздел «${to}» уже есть`)
      await update(restaurantId, rows.filter((r) => r.menu_section === from.name).map((r) => r.id), { menu_section: to })
      // Подраздел у официанта с тем же названием — переименовываем и его.
      const tree = await treeOf(restaurantId)
      const subIds = tree.flatMap((s) => s.children).filter((x) => norm(x.name) === norm(from.name)).map((x) => x.id)
      if (subIds.length) {
        const { error } = await deps.db.from('menu_subsections').update({ name: to }).in('id', subIds)
        if (error) throw error
      }
      return { ok: true }
    }
    case 'move': {
      // Все блюда раздела — в другой раздел (вместе с местом у официанта).
      const from = find(body.name)
      const to = find(body.to)
      if (!from || !to || from === to) throw httpError(400, 'Выберите, в какой раздел перенести блюда')
      await update(restaurantId, rows.filter((r) => r.menu_section === from.name).map((r) => r.id), {
        menu_section: to.name, section_order: to.order,
        section_id: to.place.sectionId, subsection_id: to.place.subsectionId, sub_subsection_id: to.place.subSubsectionId,
      })
      await dropEmptySubsection(restaurantId, from.name)
      return { ok: true }
    }
    case 'delete': {
      const s = find(body.name)
      if (s?.dishes) throw httpError(409, 'В разделе есть блюда — сначала перенесите или удалите их')
      await dropEmptySubsection(restaurantId, body.name)
      return { ok: true }
    }
    default:
      throw httpError(400, 'Неизвестное действие с разделом')
  }
}

// Подраздел у официанта с названием удалённого раздела — убираем, если в нём
// не осталось блюд.
async function dropEmptySubsection(restaurantId, name) {
  const tree = await treeOf(restaurantId)
  const subs = tree.flatMap((s) => s.children).filter((x) => norm(x.name) === norm(name))
  for (const sub of subs) {
    const { data, error } = await deps.db.from('menu_items').select('id').eq('restaurant_id', restaurantId).eq('subsection_id', sub.id).limit(1)
    if (error) throw error
    if (data?.length) continue
    const { error: delErr } = await deps.db.from('menu_subsections').delete().eq('id', sub.id)
    if (delErr) throw delErr
  }
}

// Фото блюда с компьютера: браузер уже уменьшил его (крупное — для карточки,
// миниатюра — для списка); кладём оба в хранилище, как и прежние фото меню:
// menu-images/<ресторан>/dishes/<блюдо>_<хэш>.webp и …_thumb.webp. Хэш от
// содержимого — новая картинка получает новый адрес, гость не увидит старую
// из кэша. В меню ссылки попадут, когда блюдо сохранят.
export const PHOTO_BUCKET = 'menu-images'

export async function uploadPhoto(restaurantId, body) {
  const photo = decodeImage(body.photo, 'Фото')
  const thumb = body.thumb ? decodeImage(body.thumb, 'Миниатюра') : photo
  const dish = /^[0-9a-f-]{36}$/i.test(String(body.dishId || '')) ? body.dishId : 'new'
  const hash = crypto.createHash('sha1').update(photo.buf).digest('hex').slice(0, 8)
  const base = `${restaurantId}/dishes/${dish}_${hash}`
  const storage = deps.db.storage.from(PHOTO_BUCKET)
  const urls = {}
  for (const [key, img, suffix] of [['imageUrl', photo, ''], ['thumbUrl', thumb, '_thumb']]) {
    const path = `${base}${suffix}.${img.ext}`
    const { error } = await storage.upload(path, img.buf, { contentType: img.type, upsert: true, cacheControl: '31536000' })
    if (error) {
      console.error('menu photo upload failed:', error)
      throw httpError(502, 'Хранилище фото не ответило — попробуйте ещё раз')
    }
    urls[key] = storage.getPublicUrl(path).data.publicUrl
  }
  return urls
}
