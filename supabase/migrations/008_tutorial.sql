-- Migración 008 — marca si el usuario ya vio el tutorial inicial
alter table public.profiles add column if not exists tutorial_done boolean default false;
