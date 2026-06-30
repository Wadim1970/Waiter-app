-- ============================================================
-- Миграция 1: SMS-коды и связка с Supabase Auth
--
-- Что делает:
--   1. Включает расширение pgcrypto (для хеширования кодов).
--   2. Создаёт таблицу public.sms_codes — там waiter-api хранит ХЕШИ кодов,
--      присланных в SMS. Сама таблица закрыта RLS, читать/писать её может
--      только service_role (то есть только наш бэкенд).
--   3. Добавляет в public.waiters колонку auth_user_id — связь со строкой
--      в auth.users. Пока NULL у всех; заполнится при первом входе через
--      новую авторизацию.
--
-- Что НЕ ломает:
--   - Старые колонки pin_code / pin_expires_at / device_id / access_code
--     не трогаются. Текущий поток регистрации продолжает работать.
--   - Никакие существующие RLS-политики не меняются.
--
-- Откат: см. файл 001_sms_codes_and_auth_link_rollback.sql
-- ============================================================

BEGIN;

-- 1. Расширения --------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Таблица sms_codes -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_codes (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         text NOT NULL,
    code_hash     text NOT NULL,                              -- bcrypt-хеш кода
    attempts      integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    consumed_at   timestamptz                                 -- проставится при успешной проверке
);

-- Один активный код на телефон. Если придёт новый запрос — старый удалится в бэкенде.
CREATE INDEX IF NOT EXISTS sms_codes_phone_active_idx
    ON public.sms_codes (phone)
    WHERE consumed_at IS NULL;

-- Авточистка протухших кодов (см. ниже комментарий — задача наружу не торчит)
CREATE INDEX IF NOT EXISTS sms_codes_expires_at_idx
    ON public.sms_codes (expires_at);

-- 3. RLS на sms_codes — закрываем доступ всем, кроме service_role -----------
ALTER TABLE public.sms_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_codes FORCE ROW LEVEL SECURITY;

-- Никаких политик не создаём: при включённом RLS без политик доступ закрыт.
-- service_role (наш бэкенд) обходит RLS — он сможет читать/писать.
-- anon и authenticated не увидят ничего.

-- 4. Связка waiters ↔ auth.users --------------------------------------------
ALTER TABLE public.waiters
    ADD COLUMN IF NOT EXISTS auth_user_id uuid
        REFERENCES auth.users(id) ON DELETE SET NULL;

-- Один auth-пользователь — один официант (когда заполнится)
CREATE UNIQUE INDEX IF NOT EXISTS waiters_auth_user_id_unique_idx
    ON public.waiters (auth_user_id)
    WHERE auth_user_id IS NOT NULL;

-- 5. Видимость новой колонки через PostgREST --------------------------------
NOTIFY pgrst, 'reload schema';

COMMIT;

-- ============================================================
-- ПРИМЕЧАНИЕ про чистку устаревших кодов:
-- Удалять старые записи будет сам бэкенд (waiter-api) при каждом
-- запросе /api/send-sms — он чистит все записи по этому телефону,
-- прежде чем класть новую. Отдельный pg_cron не нужен.
-- ============================================================
