-- ============================================================
-- Миграция 4: вью tables_with_active_session (фикс N+1 в getAllTables/getMyTables)
--
-- ЗАЧЕМ:
--   getAllTables/getMyTables тянули ВСЮ историю table_sessions по столу
--   (годы закрытых смен) и искали активную сессию через .find(is_active)
--   на клиенте. С ростом истории это без нужды раздувает объём ответа.
--
--   Эта вью делает LEFT JOIN tables + ЕДИНСТВЕННАЯ активная сессия прямо
--   в БД — фронт получает уже готовую плоскую строку на стол, без истории.
--
-- ВАЖНО про security_invoker:
--   tables/table_sessions сейчас открыты (RLS USING(true)) — предстоит
--   отдельный проход по закрытию RLS операционных таблиц. Вью создана
--   с security_invoker=true (Postgres 15+), поэтому она ВСЕГДА проверяет
--   права так, как будто запрос идёт напрямую к tables/table_sessions от
--   имени того, кто её вызвал — а не от имени владельца вью (supabase_admin,
--   суперюзер). Без этой опции вью от суперюзера могла бы молча обходить
--   будущие RLS-политики на tables/table_sessions, сводя на нет тот фикс.
--   Проверено локально: RLS-политика на tables корректно фильтрует
--   результат вью по ресторану.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < server/migrations/004_tables_with_active_session_view.sql
--
-- Откат: 004_tables_with_active_session_view_rollback.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW public.tables_with_active_session
WITH (security_invoker = true)
AS
SELECT
  t.id,
  t.restaurant_id,
  t.number,
  t.zone,
  t.capacity,
  t.is_active AS table_is_active,
  ts.id AS session_id,
  ts.status AS session_status,
  ts.guest_count,
  ts.started_at,
  ts.waiter_id AS session_waiter_id
FROM public.tables t
LEFT JOIN public.table_sessions ts
  ON ts.table_id = t.id AND ts.is_active = true;

GRANT SELECT ON public.tables_with_active_session TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
