-- ============================================================
-- ОТКАТ миграции 004.
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS public.tables_with_active_session;

NOTIFY pgrst, 'reload schema';

COMMIT;
