BEGIN;

DROP INDEX IF EXISTS public.sms_codes_phone_purpose_active_idx;
CREATE INDEX IF NOT EXISTS sms_codes_phone_active_idx
    ON public.sms_codes (phone)
    WHERE consumed_at IS NULL;

ALTER TABLE public.sms_codes DROP COLUMN IF EXISTS purpose;

NOTIFY pgrst, 'reload schema';

COMMIT;
