-- supabase_rls_policies.sql

-- Enable RLS for all relevant bot state tables
ALTER TABLE public.bot_active_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_daily_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_active_missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_treasure_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_notifications_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_command_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_lifecycle_log ENABLE ROW LEVEL SECURITY;

-- Add policy allowing full access to the service_role for each table
CREATE POLICY "service_role_bot_active_bets" ON public.bot_active_bets FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_bot_daily_claims" ON public.bot_daily_claims FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_bot_active_missions" ON public.bot_active_missions FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_bot_treasure_events" ON public.bot_treasure_events FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_bot_treasure_claims" ON public.bot_treasure_claims FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_bot_notifications_queue" ON public.bot_notifications_queue FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_bot_command_logs" ON public.bot_command_logs FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_players" ON public.players FOR ALL USING (current_user = 'service_role');
CREATE POLICY "service_role_player_lifecycle_log" ON public.player_lifecycle_log FOR ALL USING (current_user = 'service_role');
