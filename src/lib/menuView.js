// Копии блюд в подразделе «Популярное».
//
// Блюдо, которое стоит и в «Популярном», и в своём подразделе («Борщ» в «Супах»),
// хранится в базе двумя строками: у строки один подраздел. Гость видит
// «Популярное» отдельной группой — там это задумано. А в режиме «Все» у
// официанта обе копии шли подряд — «два борща».
//
// В режиме «Все» прячем копию из «Популярного», только если у того же блюда
// есть строка в другом подразделе (совпало название) — блюдо, которое есть
// лишь в «Популярном», остаётся. Блюда с одинаковым названием, но в разных
// подразделах (детская порция «Спагетти Болоньезе») не затрагиваются: прячутся
// только копии из «Популярного». Сама вкладка «Популярное» не меняется.

const POPULAR_NAME = 'популярное'

const norm = (s) => String(s ?? '').trim().toLowerCase()

export function hidePopularCopies(dishes, subsections, activeSubsectionId) {
  if (activeSubsectionId !== 'all') return dishes
  const popularIds = new Set(
    (subsections || []).filter((s) => norm(s.name) === POPULAR_NAME).map((s) => s.id),
  )
  if (popularIds.size === 0) return dishes
  const ownNames = new Set(
    dishes.filter((d) => !popularIds.has(d.subsection_id)).map((d) => norm(d.dish_name)),
  )
  return dishes.filter((d) => !popularIds.has(d.subsection_id) || !ownNames.has(norm(d.dish_name)))
}
