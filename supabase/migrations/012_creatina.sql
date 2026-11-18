-- =====================================================================
-- Migración 012 — check diario de suplementos (creatina) y recordatorio
-- =====================================================================
alter table public.profiles add column if not exists track_creatine boolean default false;

create table if not exists public.supplement_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  log_date   date not null,
  item       text not null default 'creatina',
  created_at timestamptz default now(),
  unique (user_id, log_date, item)
);
alter table public.supplement_logs enable row level security;
drop policy if exists "solo dueño" on public.supplement_logs;
create policy "solo dueño" on public.supplement_logs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.supplement_logs to authenticated;
grant usage, select on all sequences in schema public to authenticated;
