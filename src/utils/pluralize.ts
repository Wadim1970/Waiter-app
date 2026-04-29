/**
 * Склонение существительных в русском языке
 * @param count - Количество (ч��сло)
 * @param one - Форма для 1, 21, 31... (например, "отзыв")
 * @param few - Форма для 2-4, 22-24... (например, "отзыва")
 * @param many - Форма для 0, 5-20, 25-30... (например, "отзывов")
 * @returns Правильная форма слова
 */
export function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  
  if (mod10 === 1 && mod100 !== 11) {
    return one
  }
  
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few
  }
  
  return many
}

// Готовые функции для частых случаев
export const pluralizeReviews = (count: number) => 
  pluralize(count, 'отзыв', 'отзыва', 'отзывов')

export const pluralizeJobs = (count: number) => 
  pluralize(count, 'вакансия', 'вакансии', 'вакансий')

export const pluralizePeople = (count: number) => 
  pluralize(count, 'человек', 'человека', 'человек')

export const pluralizeSlots = (count: number) => 
  pluralize(count, 'место', 'места', 'мест')
