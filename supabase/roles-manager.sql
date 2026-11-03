-- Roles: user (kalkulátor + nakládka), manager (vše kromě uživatelů a tiketů), admin (vše).
-- Run once in Supabase → SQL Editor.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'manager', 'user'));

-- may edit shared settings (catalog, combos, …): admin and manager
create or replace function public.can_edit()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin', 'manager'));
$$;

drop policy if exists "settings: admin inserts" on public.settings;
create policy "settings: admin inserts" on public.settings
  for insert to authenticated with check (public.can_edit());
drop policy if exists "settings: admin updates" on public.settings;
create policy "settings: admin updates" on public.settings
  for update to authenticated using (public.can_edit()) with check (public.can_edit());
-- profiles (roles) and tickets stay admin-only through public.is_admin()
