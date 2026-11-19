-- =====================================================================
-- Migración 018 — macros puestas a mano en el perfil (null = automático)
-- =====================================================================
alter table public.profiles add column if not exists protein_manual int;
alter table public.profiles add column if not exists carbs_manual int;
alter table public.profiles add column if not exists fat_manual int;
