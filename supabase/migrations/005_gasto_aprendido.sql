-- =====================================================================
-- Migración 005 — gasto promedio aprendido del historial del reloj
-- =====================================================================
alter table public.profiles add column if not exists learned_tdee int;   -- promedio real (últimos 28 días con cierre del reloj)
alter table public.profiles add column if not exists learned_days int default 0;
alter table public.profiles add column if not exists learned_at date;
