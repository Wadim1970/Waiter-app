-- ============================================================
-- Миграция 3: restaurant_id в table_sessions (для Realtime-фильтра)
--
-- ЗАЧЕМ:
--   TablesScreen подписывается на ВСЕ изменения table_sessions без
--   фильтра — каждое устройство официанта получает события об изменении
--   столов ВСЕХ ресторанов. Supabase Realtime умеет фильтровать
--   (filter: "restaurant_id=eq.<id>") только по колонке ТОЙ ЖЕ таблицы,
--   которую слушаешь. Сейчас у table_sessions такой колонки нет —
--   привязка к ресторану идёт только через table_id -> tables.restaurant_id
--   (два прыжка), а так фильтровать нельзя.
--
--   Эта миграция дублирует restaurant_id прямо в table_sessions и
--   заполняет его триггером на INSERT/UPDATE(table_id), так что код
--   приложения менять не нужно — колонка живёт сама.
--
-- НЕ ломает ничего существующего: чисто добавочная операция.
-- Можно применять в любой момент, порядок с деплоем фронта не важен
-- (старый фронт просто не использует новую колонку, новый — начнёт).
--
-- Без FK на restaurants(id) намеренно: это чисто денормализованное поле
-- для фильтрации Realtime, не для целостности; тип берём из
-- tables.restaurant_id (uuid), который уже используется по всему коду.
--
-- Запускать из-под supabase_admin (он владелец table_sessions):
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < server/migrations/003_table_sessions_restaurant_id.sql
--
-- Откат: 003_table_sessions_restaurant_id_rollback.sql
-- ============================================================

BEGIN;

-- 1. Колонка
ALTER TABLE public.table_sessions
  ADD COLUMN IF NOT EXISTS restaurant_id uuid;

-- 2. Backfill существующих строк из tables.restaurant_id
UPDATE public.table_sessions ts
SET restaurant_id = t.restaurant_id
FROM public.tables t
WHERE ts.table_id = t.id
  AND ts.restaurant_id IS NULL;

-- 3. Триггер: на каждый INSERT и на UPDATE table_id подставляет
--    актуальный restaurant_id из tables. Приложению ничего передавать не нужно.
CREATE OR REPLACE FUNCTION public.sync_table_session_restaurant_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT restaurant_id INTO NEW.restaurant_id
  FROM public.tables
  WHERE id = NEW.table_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_table_session_restaurant_id ON public.table_sessions;
CREATE TRIGGER trg_sync_table_session_restaurant_id
  BEFORE INSERT OR UPDATE OF table_id ON public.table_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_table_session_restaurant_id();

-- 4. Индекс — фильтрация (и любые будущие запросы) быстрая
CREATE INDEX IF NOT EXISTS table_sessions_restaurant_id_idx
  ON public.table_sessions (restaurant_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
