-- Enable RLS and grant full access to service_role for bot_active_bets
ALTER TABLE public.bot_active_bets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_active_bets" ON public.bot_active_bets FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable RLS and grant full access to service_role for bot_daily_claims
ALTER TABLE public.bot_daily_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_daily_claims" ON public.bot_daily_claims FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable RLS and grant full access to service_role for bot_active_missions
ALTER TABLE public.bot_active_missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_active_missions" ON public.bot_active_missions FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable RLS and grant full access to service_role for bot_treasure_events
ALTER TABLE public.bot_treasure_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_treasure_events" ON public.bot_treasure_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable RLS and grant full access to service_role for bot_treasure_claims
ALTER TABLE public.bot_treasure_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_treasure_claims" ON public.bot_treasure_claims FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable RLS and grant full access to service_role for bot_notifications_queue
ALTER TABLE public.bot_notifications_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_notifications_queue" ON public.bot_notifications_queue FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable RLS and grant full access to service_role for bot_command_logs
ALTER TABLE public.bot_command_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on bot_command_logs" ON public.bot_command_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable RLS and grant full access to service_role for player_lifecycle_log
ALTER TABLE public.player_lifecycle_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on player_lifecycle_log" ON public.player_lifecycle_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Also enable for players if not already enabled (although might be out of scope, safe to apply)
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on players" ON public.players FOR ALL TO service_role USING (true) WITH CHECK (true);
