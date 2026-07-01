-- ============================================================
-- ОТКАТ миграции 002.
-- Возвращает waiters и bookings к «открытому» состоянию (как было).
-- Применять только если новые политики что-то сломали и нужно срочно
-- вернуть работу старому механизму.
-- ============================================================

BEGIN;

-- waiters: вернуть открытые политики
DROP POLICY IF EXISTS "waiter_select_own" ON public.waiters;
DROP POLICY IF EXISTS "waiter_update_own" ON public.waiters;

CREATE POLICY "Allow anon select waiters" ON public.waiters FOR SELECT USING (true);
CREATE POLICY "Allow anon insert waiters" ON public.waiters FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anon update waiters" ON public.waiters FOR UPDATE USING (true);

-- bookings: вернуть политики на app.current_user_id + auth.uid()
DROP POLICY IF EXISTS "bookings_select"       ON public.bookings;
DROP POLICY IF EXISTS "bookings_insert_own"   ON public.bookings;
DROP POLICY IF EXISTS "bookings_update"       ON public.bookings;
DROP POLICY IF EXISTS "bookings_delete_own"   ON public.bookings;

CREATE POLICY "Workers can view own bookings" ON public.bookings
  FOR SELECT USING ((worker_id)::text = current_setting('app.current_user_id', true));
CREATE POLICY "Workers can update own bookings" ON public.bookings
  FOR UPDATE USING ((worker_id)::text = current_setting('app.current_user_id', true));
CREATE POLICY "Workers can delete own bookings" ON public.bookings
  FOR DELETE USING ((worker_id)::text = current_setting('app.current_user_id', true));
CREATE POLICY "Workers can create own bookings" ON public.bookings
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can view relevant bookings" ON public.bookings
  FOR SELECT USING ((auth.uid() = worker_id) OR (EXISTS (
    SELECT 1 FROM jobs WHERE jobs.id = bookings.job_id AND jobs.restaurant_id = auth.uid())));
CREATE POLICY "Users can update booking status" ON public.bookings
  FOR UPDATE USING ((auth.uid() = worker_id) OR (EXISTS (
    SELECT 1 FROM jobs WHERE jobs.id = bookings.job_id AND jobs.restaurant_id = auth.uid())));

DROP FUNCTION IF EXISTS public.current_waiter_id();

NOTIFY pgrst, 'reload schema';

COMMIT;
