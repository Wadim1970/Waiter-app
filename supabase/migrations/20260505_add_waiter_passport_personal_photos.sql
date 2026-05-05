-- Добавление новых полей в таблицу waiters
-- Дата: 2026-05-05

ALTER TABLE public.waiters
  ADD COLUMN IF NOT EXISTS passport_department_code TEXT,
  ADD COLUMN IF NOT EXISTS personal_photo_1_url TEXT,
  ADD COLUMN IF NOT EXISTS personal_photo_2_url TEXT,
  ADD COLUMN IF NOT EXISTS personal_photo_3_url TEXT;
