-- =====================================================================
-- Migración 020 — respaldo del cierre del día (Atajo "Amigos Fit Ayer")
-- sync_tokens.yesterday_at: última vez que llegó un cierre de un día pasado pedido con "day"
-- =====================================================================
alter table public.sync_tokens add column if not exists yesterday_at timestamptz;
