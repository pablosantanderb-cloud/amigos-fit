-- =====================================================================
-- Migración 014 — datos del reloj "en vivo" durante el día (para ajustar la meta)
-- total_kcal (cierre del día) pasa a ser opcional: una fila puede tener solo datos en vivo.
-- =====================================================================
alter table public.daily_energy alter column total_kcal drop not null;
alter table public.daily_energy drop constraint if exists daily_energy_total_kcal_check;
alter table public.daily_energy add constraint daily_energy_total_kcal_check
  check (total_kcal is null or total_kcal between 500 and 10000);
alter table public.daily_energy add column if not exists live_active_kcal int;
alter table public.daily_energy add column if not exists live_resting_kcal int;
alter table public.daily_energy add column if not exists live_at timestamptz;
