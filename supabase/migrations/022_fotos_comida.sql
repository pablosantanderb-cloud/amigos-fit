-- =====================================================================
-- Migración 022 — todas las fotos de cada comida (antes solo se guardaba la primera)
-- =====================================================================
alter table public.food_logs add column if not exists photo_paths text[] not null default '{}';
update public.food_logs set photo_paths = array[photo_path] where photo_path is not null and photo_paths = '{}';
