-- ---------- tickets: bug reports from the app (description + screenshot + context) ----------
create table if not exists public.tickets (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) default auth.uid(),
  email text,
  body text not null,
  shot text,                       -- screenshot as a data URL (JPEG, shrunk in the browser)
  context jsonb,                   -- open order, its import text, tab, recent page errors
  status text not null default 'novy' check (status in ('novy', 'resi', 'hotovo')),
  note text
);
alter table public.tickets enable row level security;
drop policy if exists "tickets: logged-in insert" on public.tickets;
create policy "tickets: logged-in insert" on public.tickets
  for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "tickets: read own or admin" on public.tickets;
create policy "tickets: read own or admin" on public.tickets
  for select to authenticated using (created_by = auth.uid() or public.is_admin());
drop policy if exists "tickets: admin updates" on public.tickets;
create policy "tickets: admin updates" on public.tickets
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "tickets: admin deletes" on public.tickets;
create policy "tickets: admin deletes" on public.tickets
  for delete to authenticated using (public.is_admin());
