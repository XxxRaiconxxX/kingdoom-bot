-- Enable RLS on all referenced tables
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_active_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_daily_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_lifecycle_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_active_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.character_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grimoire_magic_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realm_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_auction_bids ENABLE ROW LEVEL SECURITY;

-- Create policies to grant full access to the service_role (bot backend)

-- players
DROP POLICY IF EXISTS "service_role_all_players" ON public.players;
CREATE POLICY "service_role_all_players" ON public.players FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- bot_active_bets
DROP POLICY IF EXISTS "service_role_all_bets" ON public.bot_active_bets;
CREATE POLICY "service_role_all_bets" ON public.bot_active_bets FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- bot_daily_claims
DROP POLICY IF EXISTS "service_role_all_daily_claims" ON public.bot_daily_claims;
CREATE POLICY "service_role_all_daily_claims" ON public.bot_daily_claims FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- player_lifecycle_log
DROP POLICY IF EXISTS "service_role_all_lifecycle" ON public.player_lifecycle_log;
CREATE POLICY "service_role_all_lifecycle" ON public.player_lifecycle_log FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- bot_treasure_events
DROP POLICY IF EXISTS "service_role_all_treasure_events" ON public.bot_treasure_events;
CREATE POLICY "service_role_all_treasure_events" ON public.bot_treasure_events FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- bot_treasure_claims
DROP POLICY IF EXISTS "service_role_all_treasure_claims" ON public.bot_treasure_claims;
CREATE POLICY "service_role_all_treasure_claims" ON public.bot_treasure_claims FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- bot_active_missions
DROP POLICY IF EXISTS "service_role_all_active_missions" ON public.bot_active_missions;
CREATE POLICY "service_role_all_active_missions" ON public.bot_active_missions FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- character_sheets
DROP POLICY IF EXISTS "service_role_all_character_sheets" ON public.character_sheets;
CREATE POLICY "service_role_all_character_sheets" ON public.character_sheets FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- grimoire_magic_styles
DROP POLICY IF EXISTS "service_role_all_grimoire_magic_styles" ON public.grimoire_magic_styles;
CREATE POLICY "service_role_all_grimoire_magic_styles" ON public.grimoire_magic_styles FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- knowledge_documents
DROP POLICY IF EXISTS "service_role_all_knowledge_documents" ON public.knowledge_documents;
CREATE POLICY "service_role_all_knowledge_documents" ON public.knowledge_documents FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- market_items
DROP POLICY IF EXISTS "service_role_all_market_items" ON public.market_items;
CREATE POLICY "service_role_all_market_items" ON public.market_items FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- player_inventory
DROP POLICY IF EXISTS "service_role_all_player_inventory" ON public.player_inventory;
CREATE POLICY "service_role_all_player_inventory" ON public.player_inventory FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- realm_events
DROP POLICY IF EXISTS "service_role_all_realm_events" ON public.realm_events;
CREATE POLICY "service_role_all_realm_events" ON public.realm_events FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- realm_missions
DROP POLICY IF EXISTS "service_role_all_realm_missions" ON public.realm_missions;
CREATE POLICY "service_role_all_realm_missions" ON public.realm_missions FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- market_auctions
DROP POLICY IF EXISTS "service_role_all_market_auctions" ON public.market_auctions;
CREATE POLICY "service_role_all_market_auctions" ON public.market_auctions FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- market_auction_bids
DROP POLICY IF EXISTS "service_role_all_market_auction_bids" ON public.market_auction_bids;
CREATE POLICY "service_role_all_market_auction_bids" ON public.market_auction_bids FOR ALL USING (auth.jwt()->>'role' = 'service_role');
