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

-- 4. Recompensa diaria del Heraldo
CREATE TABLE IF NOT EXISTS bot_daily_claims (
  id bigserial PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  claim_type text NOT NULL DEFAULT 'heraldo_daily',
  claim_date date NOT NULL,
  reward_gold integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, claim_type, claim_date)
);

CREATE INDEX IF NOT EXISTS idx_bot_daily_claims_player_date
  ON bot_daily_claims(player_id, claim_date DESC);

CREATE OR REPLACE FUNCTION claim_daily_reward(
  p_player_id uuid,
  p_claim_date date,
  p_reward_gold integer,
  p_claim_type text DEFAULT 'heraldo_daily'
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_rows integer;
BEGIN
  INSERT INTO bot_daily_claims (player_id, claim_type, claim_date, reward_gold)
  VALUES (p_player_id, p_claim_type, p_claim_date, GREATEST(p_reward_gold, 0))
  ON CONFLICT (player_id, claim_type, claim_date) DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows = 0 THEN
    RETURN false;
  END IF;

  UPDATE players
  SET
    gold = gold + GREATEST(p_reward_gold, 0),
    weekly_gold = weekly_gold + GREATEST(p_reward_gold, 0)
  WHERE id = p_player_id;

  RETURN true;
END;
$$;

-- 5. Configurar Row Level Security (RLS) para proteger las tablas principales
--    El bot accede mediante la 'service_role' key, por lo que necesita acceso total.
--    Al activar RLS sin políticas públicas, bloqueamos accesos anónimos no deseados.

-- Activar RLS en todas las tablas
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE character_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_daily_claims ENABLE ROW LEVEL SECURITY;

-- Crear política que garantiza acceso completo (ALL) a la service_role
CREATE POLICY "Service Role Full Access on players"
  ON players FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service Role Full Access on character_sheets"
  ON character_sheets FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service Role Full Access on player_inventory"
  ON player_inventory FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service Role Full Access on market_auctions"
  ON market_auctions FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service Role Full Access on market_auction_bids"
  ON market_auction_bids FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service Role Full Access on bot_daily_claims"
  ON bot_daily_claims FOR ALL USING (auth.role() = 'service_role');
