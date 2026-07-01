-- Enable Row Level Security on all relevant tables
ALTER TABLE public.bot_active_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_daily_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_active_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_notifications_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_command_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_lifecycle_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

-- Create policies for service_role to have full access
CREATE POLICY "service_role_bot_active_bets_policy" ON public.bot_active_bets
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_bot_daily_claims_policy" ON public.bot_daily_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_bot_active_missions_policy" ON public.bot_active_missions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_bot_treasure_events_policy" ON public.bot_treasure_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_bot_treasure_claims_policy" ON public.bot_treasure_claims
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_bot_notifications_queue_policy" ON public.bot_notifications_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_bot_command_logs_policy" ON public.bot_command_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_player_lifecycle_log_policy" ON public.player_lifecycle_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_players_policy" ON public.players
  FOR ALL TO service_role USING (true) WITH CHECK (true);
