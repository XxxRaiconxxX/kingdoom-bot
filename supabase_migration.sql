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

-- 2.5 Habilitar RLS explícitamente en tablas y permitir service_role
ALTER TABLE players ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'players' AND policyname = 'service_role_all_players'
  ) THEN
    CREATE POLICY service_role_all_players ON players
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

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

-- Habilitar RLS en la tabla de reclamaciones
ALTER TABLE bot_daily_claims ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'bot_daily_claims' AND policyname = 'service_role_all_claims'
  ) THEN
    CREATE POLICY service_role_all_claims ON bot_daily_claims
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

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
