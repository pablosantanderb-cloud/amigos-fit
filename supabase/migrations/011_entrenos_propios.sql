-- Migración 011 — tipos de entrenamiento propios de cada usuario
alter table public.profiles add column if not exists custom_workouts jsonb default '[]'::jsonb;
