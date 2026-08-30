// Контекст стола для ИИ-подсказок: повод/тип стола и число гостей. Это свойство
// стола (одно на стол), задаётся официантом на экране признаков и должно
// доехать до экрана меню. Основной канал — nav-state при переходе; здесь —
// бэкап в localStorage по id стола, чтобы переживал переоткрытие меню другим
// путём. Не в БД (не нужна миграция); при желании позже вынесем на сервер.
export type TableCtx = { occasion: string | null; partySize: number | null }

const key = (tableId: string) => `restai_table_ctx:${tableId}`

export function saveTableCtx(tableId: string | undefined, ctx: TableCtx): void {
  if (!tableId) return
  try {
    localStorage.setItem(key(tableId), JSON.stringify(ctx))
  } catch {
    /* приватный режим / нет доступа — не критично */
  }
}

export function readTableCtx(tableId: string | undefined): TableCtx {
  if (!tableId) return { occasion: null, partySize: null }
  try {
    const raw = localStorage.getItem(key(tableId))
    if (raw) {
      const o = JSON.parse(raw)
      return { occasion: o?.occasion ?? null, partySize: o?.partySize ?? null }
    }
  } catch {
    /* ignore */
  }
  return { occasion: null, partySize: null }
}
