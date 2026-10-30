// Карточка напитка из nutritional_info (у алкоголя там свойства, а не КБЖУ):
// «Крепость» — рядом с ценой, «Аромат» — отдельным абзацем, остальное —
// строками «Характеристики» в постоянном порядке: Полнота, Кислотность,
// Танины, Сладость, Сорт винограда, Год производства, затем прочие.
//
// Один и тот же файл в нескольких местах — держать одинаковыми:
//   Waiter-app/api/_lib/drinkProfile.js (подсказки, пары, админка)
//   Waiter-app/src/lib/drinkProfile.js  (меню официанта)
//   RestAI/src/lib/drinkProfile.js      (гостевое меню, чат)
//   RestAI/voice-relay/src/drinkProfile.js (голосовой помощник)

export const AROMA_KEY = 'Аромат'
export const GRAPE_KEY = 'Сорт винограда'
export const VINTAGE_KEY = 'Год производства'

const ORDER = ['полнота', 'кислотность', 'танины', 'сладость', 'сорт винограда', 'год производства']
// КБЖУ (в т. ч. старые ключи без единиц) и вес — не свойства напитка.
const NOT_SPECS = new Set(['calories_kcal', 'protein_g', 'fat_g', 'carbs_g', 'weight_value', 'weight_unit', 'calories', 'protein', 'fat', 'carbs'])

const isStrength = (k) => /крепост/i.test(k)
const isAroma = (k) => /^аромат/i.test(k.trim())

export function drinkProfile(info) {
  const out = { strength: null, aroma: null, grape: null, vintage: null, rows: [] }
  if (!info || typeof info !== 'object' || Array.isArray(info)) return out
  const rows = []
  for (const [k, v] of Object.entries(info)) {
    if (NOT_SPECS.has(k) || v === null || v === undefined || String(v).trim() === '') continue
    const value = String(v).trim()
    if (isStrength(k)) { out.strength = `${value.replace(/%$/, '')}%`; continue }
    if (isAroma(k)) { out.aroma = value; continue }
    if (k === GRAPE_KEY) out.grape = value
    if (k === VINTAGE_KEY) out.vintage = value
    rows.push([k, value])
  }
  const rank = (k) => {
    const i = ORDER.indexOf(k.trim().toLowerCase())
    return i === -1 ? ORDER.length : i
  }
  out.rows = rows.map((r, i) => [r, i]).sort((a, b) => rank(a[0][0]) - rank(b[0][0]) || a[1] - b[1]).map(([r]) => r)
  return out
}

// Одной строкой для ИИ (официанту, в чат, голосу): «крепость 12.5%;
// полнота: Легкое; сорт винограда: Sauvignon Blanc; аромат: цитрус…».
export function drinkNotes(info) {
  const p = drinkProfile(info)
  return [
    p.strength && `крепость ${p.strength}`,
    ...p.rows.map(([k, v]) => `${k.toLowerCase()}: ${v}`),
    p.aroma && `аромат: ${p.aroma}`,
  ].filter(Boolean).join('; ')
}
