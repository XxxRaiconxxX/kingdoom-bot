-- supabase_bot_bet_escrow.sql

-- 1. Create the bot_active_bets table for escrow
CREATE TABLE IF NOT EXISTS public.bot_active_bets (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    player_id uuid REFERENCES public.players(id) ON DELETE CASCADE NOT NULL,
    amount numeric NOT NULL CHECK (amount >= 0),
    game_type text NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- Index for querying unresolved bets quickly
CREATE INDEX IF NOT EXISTS idx_bot_active_bets_unresolved ON public.bot_active_bets (player_id) WHERE resolved = false;

-- Enable RLS and restrict to service_role
ALTER TABLE public.bot_active_bets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access for service_role only"
ON public.bot_active_bets
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- 2. place_bet RPC
-- Deducts gold and creates the bet record in one atomic transaction.
CREATE OR REPLACE FUNCTION public.place_bet(p_player_id uuid, p_amount numeric, p_game_type text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_current_gold numeric;
    v_bet_id uuid;
BEGIN
    -- Check current gold
    SELECT gold INTO v_current_gold
    FROM public.players
    WHERE id = p_player_id
    FOR UPDATE;

    IF v_current_gold IS NULL THEN
        RAISE EXCEPTION 'Player not found';
    END IF;

    IF v_current_gold < p_amount THEN
        RAISE EXCEPTION 'Insufficient gold';
    END IF;

    -- Deduct gold
    UPDATE public.players
    SET gold = gold - p_amount
    WHERE id = p_player_id;

    -- Create active bet record
    INSERT INTO public.bot_active_bets (player_id, amount, game_type, resolved)
    VALUES (p_player_id, p_amount, p_game_type, false)
    RETURNING id INTO v_bet_id;

    RETURN v_bet_id;
END;
$$;

-- 3. resolve_bet RPC
-- Closes the bet and adds payout if any. Returns boolean indicating success.
CREATE OR REPLACE FUNCTION public.resolve_bet(p_bet_id uuid, p_payout numeric)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bet record;
BEGIN
    -- Lock the bet record
    SELECT * INTO v_bet
    FROM public.bot_active_bets
    WHERE id = p_bet_id
    FOR UPDATE;

    IF v_bet IS NULL THEN
        RAISE EXCEPTION 'Bet not found';
    END IF;

    IF v_bet.resolved THEN
        RAISE EXCEPTION 'Bet already resolved';
    END IF;

    -- Mark as resolved
    UPDATE public.bot_active_bets
    SET resolved = true
    WHERE id = p_bet_id;

    -- If payout > 0, add to player's gold
    IF p_payout > 0 THEN
        UPDATE public.players
        SET gold = gold + p_payout
        WHERE id = v_bet.player_id;
    END IF;

    RETURN true;
END;
$$;
