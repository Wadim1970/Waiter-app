// Время дня и «роль» блюда — ЧИСТАЯ логика, общая для всех советов: совет к
// корзине гостя, пары «к этому блюду подойдёт», подсказки официанту.
//
// Приём пищи — по часам ресторана: до 12:00 завтрак, до 17:00 обед, до 22:00
// ужин, позже (и до 06:00) — поздний вечер, лёгкий ужин. Корзина поправляет
// часы: сырники и капучино в 15:00 — это завтрак (в меню «завтраки весь
// день»), а стейк в 10 утра — уже не завтрак.
//
// Роль блюда — по разделу меню и названию; menu_items.course_role и
// menu_items.meal_times (если заданы вручную) важнее.

import { tzOffsetMinutes } from './hallCore.js'

export const MEALS = ['breakfast', 'lunch', 'dinner', 'late']
export const MEAL_LABELS = { breakfast: 'завтрак', lunch: 'обед', dinner: 'ужин', late: 'поздний ужин' }
// «К вашему …» — в дательном падеже.
export const MEAL_TO = { breakfast: 'к завтраку', lunch: 'к обеду', dinner: 'к ужину', late: 'к ужину' }

export function localHour(at, tz) {
  const t = at instanceof Date ? at : new Date(at)
  return new Date(t.getTime() + tzOffsetMinutes(tz, t) * 60000).getUTCHours()
}

export function mealAt(at, tz) {
  const h = localHour(at, tz)
  if (h >= 6 && h < 12) return 'breakfast'
  if (h >= 12 && h < 17) return 'lunch'
  if (h >= 17 && h < 22) return 'dinner'
  return 'late'
}

export const ROLES = ['breakfast', 'soup', 'salad', 'starter', 'main', 'side', 'sauce', 'bread', 'soft', 'hot_drink', 'alco', 'dessert', 'other']
const FOOD_ROLES = new Set(['breakfast', 'soup', 'salad', 'starter', 'main', 'side', 'bread', 'other'])
export const isFood = (role) => FOOD_ROLES.has(role)
export const isDrink = (role) => role === 'soft' || role === 'hot_drink' || role === 'alco'

const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е')
// В регулярках ниже вместо \b — (?<![а-яa-z]) и (?![а-яa-z]): \b в JS не
// видит границ русских слов.

const ALCO_RE = /вин[оа]|бокал|игрист|просекко|шампан|виски|коньяк|аперол|пиво|(?<![а-яa-z])ром(?![а-яa-z])|текил|джин|ликер|вермут|портвейн|наливк|глинтвейн|сидр|водк|бренди|кальвадос|коктейл[ьи] алко|настойк|саке|граппа/
const HOT_RE = /кофе|капучино|латте|эспрессо|американо|(?<![а-яa-z])раф(?![а-яa-z])|флэт|флет|чай(?![а-яa-z])|чай |чаи|какао|матча|горяч(ий|ее) шоколад|пунш/
const SOFT_RE = /напит|(?<![а-яa-z])сок|лимонад|морс|смузи|компот|тоник|вода|милкшейк|молочный коктейль|кола|фреш|айран|квас|холодный чай|айс/
const BREAKFAST_SECTION_RE = /завтрак|бранч/
const BREAKFAST_NAME_RE = /омлет|яичниц|глазунь|сырник|(?<![а-яa-z])каш[аи]|овсян|гранол|панкейк|скрэмбл|скрембл|бенедикт|шакшук|круассан|тост|творог с|йогурт с|мюсли|драник/
const DESSERT_RE = /десерт|торт|чизкейк|тирамису|морожен|панакот|штрудел|пирожн|наполеон|медовик|эклер|макарон|брауни|фондан|мусс|сорбет|пахлав|чак-чак|трайфл|крем-брюле|меренг|павлов/
const SOUP_RE = /(?<![а-яa-z])суп|борщ|солянк|бульон|(?<![а-яa-z])уха(?![а-яa-z])|(?<![а-яa-z])щи(?![а-яa-z])|том ям|том-ям|рамен|окрошк|гаспачо|харчо|лагман|(?<![а-яa-z])фо(?![а-яa-z])|минестроне|крем-суп|похлебк/
const SALAD_RE = /салат|(?<![а-яa-z])боул|(?<![а-яa-z])поке(?![а-яa-z])|цезарь|оливье|винегрет|греческ/
const STARTER_RE = /закуск|антипаст|брускетт|тартар|карпаччо|паштет|хумус|сырн(ая|ое) (тарелк|ассорти)|тарелк|гренк|крылышк|начос|(?<![а-яa-z])чипс|оливк|кальмар(ы)? фри|креветк(и)? темпур|сет(?![а-яa-z])|ассорти|чебурек|хинкали|спринг-ролл|ролл/
const SIDE_RE = /гарнир/
const SIDE_NAME_RE = /^(картофель|картофельн|пюре|фри(?![а-яa-z])|рис(?![а-яa-z])|гречк|овощи|спаржа|кукуруз|булгур|киноа)/
const SAUCE_RE = /соус|дип(?![а-яa-z])|топпинг/
const BREAD_RE = /хлеб|фокачч|лаваш|чиабатт|багет|лепешк|хачапури/
const MAIN_RE = /горяч|основн|(?<![а-яa-z])паст|спагетти|феттучин|карбонар|болоньез|пицц|ризотто|стейк|рибай|стриплойн|бургер|котлет|рагу|филе|шашлык|люля|запеч|гриль|мяс|рыб|птиц|утк|курин|цыпл|свин|говяд|телят|ягнен|баран|плов|вареник|пельмен|равиол|лазань|лосос|сибас|дорадо|судак|треск|креветк|медальон|бефстроганов|тушен|колбаск|шницел|эскалоп|отбивн|жульен|гуляш|манты|лапш|вок(?![а-яa-z])|удон|фунчоз/

// Роль блюда. item: {name, section, productType, role?}
export function roleOf(item) {
  if (item?.role && ROLES.includes(item.role)) return item.role
  const name = norm(item?.name)
  const section = norm(item?.section)
  const pt = item?.productType

  if (pt === 'alcohol' || ALCO_RE.test(section) || (pt !== 'food' && ALCO_RE.test(name))) return 'alco'
  if (SAUCE_RE.test(section) || /^соус/.test(name)) return 'sauce'
  if (HOT_RE.test(section) || ((pt === 'drink' || !pt) && HOT_RE.test(name) && !SOUP_RE.test(name))) return 'hot_drink'
  if (pt === 'drink' || /напит|лимонад|сок|бар(?![а-я])/.test(section)) return HOT_RE.test(name) ? 'hot_drink' : 'soft'
  if (BREAKFAST_SECTION_RE.test(section)) return 'breakfast'
  if (DESSERT_RE.test(section) || /выпечк|сладк/.test(section)) return 'dessert'
  if (SOUP_RE.test(section)) return 'soup'
  if (SIDE_RE.test(section)) return 'side'
  if (SALAD_RE.test(section) && !/закуск/.test(section)) return 'salad'
  if (/хлеб|выпечка к столу/.test(section)) return 'bread'

  // Раздел ничего не сказал («Популярное», «Хиты», «Сезонное») — по названию.
  if (SOFT_RE.test(name) && !SOUP_RE.test(name)) return 'soft'
  if (BREAKFAST_NAME_RE.test(name)) return 'breakfast'
  if (DESSERT_RE.test(name)) return 'dessert'
  if (SOUP_RE.test(name)) return 'soup'
  if (SALAD_RE.test(name)) return 'salad'
  if (SIDE_NAME_RE.test(name)) return 'side'
  if (BREAD_RE.test(name)) return 'bread'
  if (/закуск/.test(section) || STARTER_RE.test(name)) return 'starter'
  if (MAIN_RE.test(`${section} ${name}`)) return 'main'
  return 'other'
}

// Когда блюдо уместно ПРЕДЛАГАТЬ (заказать гость может что угодно и когда угодно).
const MEALS_BY_ROLE = {
  breakfast: ['breakfast'],
  soup: ['lunch'],
  salad: ['lunch', 'dinner', 'late'],
  starter: ['lunch', 'dinner', 'late'],
  main: ['lunch', 'dinner'],
  side: ['lunch', 'dinner'],
  sauce: ['lunch', 'dinner'],
  bread: ['lunch', 'dinner', 'late'],
  soft: MEALS,
  hot_drink: MEALS,
  alco: ['lunch', 'dinner', 'late'],
  dessert: MEALS,
  other: ['lunch', 'dinner'],
}

export function mealsFor(item) {
  if (Array.isArray(item?.mealTimes) && item.mealTimes.length) return item.mealTimes.filter((m) => MEALS.includes(m))
  const role = roleOf(item)
  // «Завтраки весь день» — завтрак уместен в любое время.
  if (role === 'breakfast' && /весь день|целый день|круглосуточ/.test(norm(item?.section))) return MEALS
  return MEALS_BY_ROLE[role] || MEALS_BY_ROLE.other
}

export const suitsMeal = (item, meal) => mealsFor(item).includes(meal)

// Приём пищи с поправкой на корзину: часы — основа, но завтрак в корзине
// остаётся завтраком в любое время, а горячее или суп утром — уже обед.
export function mealOfCart(roles, clockMeal) {
  const food = roles.filter(isFood)
  if (!food.length) return clockMeal
  const breakfast = food.filter((r) => r === 'breakfast').length
  if (breakfast && breakfast * 2 >= food.length) return 'breakfast'
  if (clockMeal === 'breakfast' && food.some((r) => r === 'main' || r === 'soup')) return 'lunch'
  return clockMeal
}
