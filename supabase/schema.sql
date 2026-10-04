-- ITAB kalkulátor palet: users, roles and shared settings.
-- Run once in Supabase → SQL Editor.

-- ---------- profiles: one row per login, role = admin | user ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

-- security definer so policies can ask "is the caller admin?" without recursion
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- every new login gets a profile with role 'user'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email) on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles: admin changes roles" on public.profiles;
create policy "profiles: admin changes roles" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- settings: catalog, vehicles, combos, rules as JSON ----------
create table if not exists public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);
alter table public.settings drop constraint if exists settings_key_check;
alter table public.settings add constraint settings_key_check check (key in ('catalog', 'vehicles', 'combos', 'rules', 'pallets'));
alter table public.settings enable row level security;
drop policy if exists "settings: logged-in users read" on public.settings;
create policy "settings: logged-in users read" on public.settings
  for select to authenticated using (true);
drop policy if exists "settings: admin inserts" on public.settings;
create policy "settings: admin inserts" on public.settings
  for insert to authenticated with check (public.is_admin());
drop policy if exists "settings: admin updates" on public.settings;
create policy "settings: admin updates" on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles for users that existed before this script
insert into public.profiles (id, email) select id, email from auth.users on conflict (id) do nothing;

-- After your own first login, make yourself admin (replace the e-mail):
-- update public.profiles set role = 'admin' where email = 'vas@email.cz';
