-- =============================================
-- Kingdoom Bot — Migración Supabase
-- Correr una sola vez en el SQL Editor de Supabase
-- =============================================

-- 1. Función atómica para incrementar/decrementar oro
--    Evita race conditions cuando dos operaciones corren a la vez
CREATE OR REPLACE FUNCTION increment_gold(player_id uuid, amount integer)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE players
  SET
    gold        = gold + amount,
    weekly_gold = weekly_gold + GREATEST(amount, 0)  -- solo suma, nunca resta del weekly
  WHERE id = player_id;
$$;

-- 2. Columna 'banned' por si no la tenés todavía
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS banned boolean DEFAULT false;

-- 3. Columna 'phone' — asegurarse que existe e indexada
CREATE INDEX IF NOT EXISTS idx_players_phone ON players(phone);
