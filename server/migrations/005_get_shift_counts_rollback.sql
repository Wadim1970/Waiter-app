-- ============================================================
-- ОТКАТ.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS public.get_shift_counts(uuid);

NOTIFY pgrst, 'reload schema';

COMMIT;
