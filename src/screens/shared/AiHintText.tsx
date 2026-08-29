// Рендер подсказки RestAI: текст в кавычках «…» — это реплика, которую
// официант произносит гостю, выделяем её жирным. Остальное (директива —
// «что предложить») остаётся обычным шрифтом. По договорённости с промтом
// (см. api/_lib/suggestCore.js) в «…» попадает ТОЛЬКО произносимая фраза,
// названия блюд в директиве идут без кавычек.
export default function AiHintText({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('«') && part.endsWith('»')
          ? <strong key={i}>{part}</strong>
          : <span key={i}>{part}</span>,
      )}
    </>
  )
}
