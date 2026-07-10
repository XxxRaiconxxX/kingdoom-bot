-- Enable Row Level Security for all tables
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_daily_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_active_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_active_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_notifications_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_command_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_lifecycle_log ENABLE ROW LEVEL SECURITY;

-- Grant full access exclusively to the service_role for all tables
CREATE POLICY "service_role_all_players" ON public.players FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_bot_daily_claims" ON public.bot_daily_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_bot_active_bets" ON public.bot_active_bets FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_bot_active_missions" ON public.bot_active_missions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_bot_treasure_events" ON public.bot_treasure_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_bot_treasure_claims" ON public.bot_treasure_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_bot_notifications_queue" ON public.bot_notifications_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_bot_command_logs" ON public.bot_command_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_player_lifecycle_log" ON public.player_lifecycle_log FOR ALL TO service_role USING (true) WITH CHECK (true);
