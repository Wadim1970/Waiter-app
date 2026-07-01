-- ============================================================
-- get_shift_counts: агрегация счётчиков смен в БД вместо выгрузки
-- всех строк ради подсчёта в JS.
--
-- ЗАЧЕМ:
--   getShiftCounts грузил ВСЕ bookings официанта в статусах
--   applied/approved/confirmed (без .limit) только чтобы посчитать
--   3 числа для бейджей. bookings не удаляются — за долгую карьеру
--   официанта это сотни строк по сети ради простого счёта.
--
--   GROUP BY считает прямо в Postgres, по сети едут только
--   несколько строк вида (status, count).
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < server/migrations/005_get_shift_counts.sql
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.get_shift_counts(p_worker_id uuid)
RETURNS TABLE (status text, cnt bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.status, count(*)
  FROM public.bookings b
  WHERE b.worker_id = p_worker_id
    AND b.status IN ('applied', 'approved', 'confirmed')
  GROUP BY b.status;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_counts(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
