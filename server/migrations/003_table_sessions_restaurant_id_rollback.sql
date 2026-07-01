-- ============================================================
-- ОТКАТ миграции 003.
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_sync_table_session_restaurant_id ON public.table_sessions;
DROP FUNCTION IF EXISTS public.sync_table_session_restaurant_id();
DROP INDEX IF EXISTS public.table_sessions_restaurant_id_idx;
ALTER TABLE public.table_sessions DROP COLUMN IF EXISTS restaurant_id;

NOTIFY pgrst, 'reload schema';

COMMIT;
