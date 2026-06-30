-- ============================================================
-- ОТКАТ миграции 001.
-- Применять ТОЛЬКО если что-то пошло не так и ещё НЕ начали
-- использовать auth_user_id в коде.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS public.waiters_auth_user_id_unique_idx;
ALTER TABLE public.waiters DROP COLUMN IF EXISTS auth_user_id;

DROP TABLE IF EXISTS public.sms_codes;

NOTIFY pgrst, 'reload schema';

COMMIT;
