-- ============================================================
-- Миграция 2: RLS по auth.uid() для waiters и bookings
--
-- ЗАЧЕМ:
--   Сейчас waiters открыт всем (политики anon = true) — любой с anon-ключом
--   читает и меняет ВСЕ записи официантов, включая паспорта. Это и есть
--   дыра с идентичностью. bookings при этом завязан на app.current_user_id,
--   который мы больше не выставляем (перешли на JWT-сессии).
--
--   Эта миграция переводит waiters и bookings на auth.uid() из JWT.
--
-- МОДЕЛЬ:
--   auth.uid()        = auth.users.id (из JWT)
--   waiters.id        = собственный id официанта (worker_id в bookings)
--   waiters.auth_user_id = связка с auth.users (заполнил бэкенд в verify-sms)
--   Хелпер current_waiter_id() отображает auth.uid() -> waiters.id.
--
-- ВАЖНО: применять СОГЛАСОВАННО с выкаткой Stage 3 фронта (JWT-сессии).
--   До появления сессий строгие политики отдадут пусто — это ожидаемо.
--
-- Запускать из-под supabase_admin:
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < server/migrations/002_rls_waiters_bookings.sql
--
-- Откат: 002_rls_waiters_bookings_rollback.sql
-- ============================================================

BEGIN;

-- ── Хелпер: auth.uid() -> waiters.id ───────────────────────────────────────
-- SECURITY DEFINER (владелец — суперюзер) читает waiters в обход RLS,
-- поэтому рекурсии политик не возникает.
CREATE OR REPLACE FUNCTION public.current_waiter_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.waiters WHERE auth_user_id = auth.uid()
$$;

GRANT EXECUTE ON FUNCTION public.current_waiter_id() TO anon, authenticated, service_role;

-- ── waiters: закрываем «открыто всем» ──────────────────────────────────────
DROP POLICY IF EXISTS "Allow anon select waiters" ON public.waiters;
DROP POLICY IF EXISTS "Allow anon insert waiters" ON public.waiters;
DROP POLICY IF EXISTS "Allow anon update waiters" ON public.waiters;

-- Официант видит и редактирует ТОЛЬКО свою запись (по связке с auth.users).
CREATE POLICY "waiter_select_own" ON public.waiters
  FOR SELECT
  USING (auth_user_id = auth.uid());

CREATE POLICY "waiter_update_own" ON public.waiters
  FOR UPDATE
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- INSERT не даём ни anon, ни authenticated: новых официантов создаёт только
-- бэкенд (service_role обходит RLS). Отдельной INSERT-политики нет = запрещено.

-- ── bookings: с app.current_user_id -> на current_waiter_id() ──────────────
DROP POLICY IF EXISTS "Workers can view own bookings"   ON public.bookings;
DROP POLICY IF EXISTS "Workers can update own bookings"  ON public.bookings;
DROP POLICY IF EXISTS "Workers can delete own bookings"  ON public.bookings;
DROP POLICY IF EXISTS "Workers can apply for jobs"       ON public.bookings;
DROP POLICY IF EXISTS "Workers can create own bookings"  ON public.bookings;
DROP POLICY IF EXISTS "Users can view relevant bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can update booking status"  ON public.bookings;

-- Официант видит свои заявки; ресторан — заявки на свои вакансии.
CREATE POLICY "bookings_select" ON public.bookings
  FOR SELECT
  USING (
    worker_id = public.current_waiter_id()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = bookings.job_id AND j.restaurant_id = auth.uid()
    )
  );

-- Официант создаёт заявки только от своего имени.
CREATE POLICY "bookings_insert_own" ON public.bookings
  FOR INSERT
  WITH CHECK (worker_id = public.current_waiter_id());

-- Обновлять может официант (свои) и ресторан (по своим вакансиям).
CREATE POLICY "bookings_update" ON public.bookings
  FOR UPDATE
  USING (
    worker_id = public.current_waiter_id()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = bookings.job_id AND j.restaurant_id = auth.uid()
    )
  )
  WITH CHECK (
    worker_id = public.current_waiter_id()
    OR EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.id = bookings.job_id AND j.restaurant_id = auth.uid()
    )
  );

-- Удалять свои заявки может только сам официант.
CREATE POLICY "bookings_delete_own" ON public.bookings
  FOR DELETE
  USING (worker_id = public.current_waiter_id());

NOTIFY pgrst, 'reload schema';

COMMIT;
