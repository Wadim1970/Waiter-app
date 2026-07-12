-- ============================================================
-- Миграция 6: изоляция SMS-кодов официанта и гостя
--
-- ЗАЧЕМ:
--   sms_codes хранит коды по одному ключу — phone, без разделения
--   "кто за этим номером". Официант и гость (участник викторины
--   RestAI) — разные сущности, но вполне могут иметь один и тот же
--   номер телефона. До этой миграции sendSmsCode() при отправке
--   нового кода удалял ВСЕ старые записи по этому phone (DELETE ...
--   WHERE phone = $1) — если один и тот же номер использовался и для
--   входа официанта, и для регистрации гостя, более поздний запрос
--   кода стирал ещё не введённый код от более раннего запроса, и
--   verifySmsCode() отвечал "код не запрашивался или уже использован"
--   даже с только что пришедшим правильным кодом.
--
--   Добавляем purpose ('waiter' | 'guest'), и все операции с
--   sms_codes теперь фильтруются по паре (phone, purpose) — коды
--   официанта и коды гостя больше не видят и не затирают друг друга,
--   даже если номер телефона совпадает.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < server/migrations/006_sms_codes_purpose.sql
--
-- Откат: см. 006_sms_codes_purpose_rollback.sql
-- ============================================================

BEGIN;

ALTER TABLE public.sms_codes
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'waiter';

DROP INDEX IF EXISTS public.sms_codes_phone_active_idx;
CREATE INDEX IF NOT EXISTS sms_codes_phone_purpose_active_idx
    ON public.sms_codes (phone, purpose)
    WHERE consumed_at IS NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
