-- Ejecutar en el Supabase dedicado del bot.
-- Hace reproducible la proteccion que ya existe en produccion para el estado interno.

begin;

do $$
declare
  v_table_name text;
begin
  foreach v_table_name in array array[
    'bot_active_bets',
    'bot_daily_claims',
    'bot_active_missions',
    'bot_treasure_events',
    'bot_treasure_claims',
    'bot_notifications_queue',
    'bot_command_logs',
    'bot_game_rewards'
  ]
  loop
    if to_regclass('public.' || v_table_name) is null then
      raise exception 'Required bot-state table is missing: %', v_table_name;
    end if;

    execute format('alter table public.%I enable row level security', v_table_name);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated',
      v_table_name
    );
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      v_table_name
    );
  end loop;
end;
$$;

do $$
begin
  if to_regprocedure('public.claim_bot_treasure_reward(text,uuid,text)') is not null then
    revoke all on function public.claim_bot_treasure_reward(text, uuid, text) from public, anon, authenticated;
    grant execute on function public.claim_bot_treasure_reward(text, uuid, text) to service_role;
  end if;
end;
$$;

commit;
