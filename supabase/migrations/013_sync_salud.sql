-- =====================================================================
-- Migración 013 — código personal para sincronizar Apple Salud vía Atajos
-- Tabla aparte (no en profiles) para que los amigos del grupo nunca puedan leerlo.
-- =====================================================================
create table if not exists public.sync_tokens (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  token      text not null unique check (length(token) >= 20),
  created_at timestamptz default now(),
  last_used_at timestamptz
);
alter table public.sync_tokens enable row level security;
drop policy if exists "solo dueño" on public.sync_tokens;
create policy "solo dueño" on public.sync_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.sync_tokens to authenticated;

-- el servidor (service_role) necesita leer códigos y guardar el cierre del día
grant select, update on public.sync_tokens to service_role;
grant select, insert, update on public.daily_energy to service_role;
grant usage, select on all sequences in schema public to service_role;
