-- Ejecutar en el Supabase dedicado del bot.
-- Reserva uso + resultado del cofre en una transaccion y permite reconciliar el oro principal.

begin;

create table if not exists public.bot_game_rewards (
  id uuid primary key default gen_random_uuid(),
  source_message_id text not null unique,
  player_id uuid not null,
  game_type text not null,
  usage_count integer not null check (usage_count > 0),
  reward_gold integer not null check (reward_gold >= 0),
  result_summary text not null,
  credit_status text not null default 'pending' check (credit_status in ('pending', 'credited')),
  created_at timestamptz not null default timezone('utc', now()),
  credited_at timestamptz
);

create index if not exists idx_bot_game_rewards_pending
  on public.bot_game_rewards (created_at)
  where credit_status = 'pending';

alter table public.bot_game_rewards enable row level security;
revoke all on table public.bot_game_rewards from public, anon, authenticated;
grant select, insert, update on table public.bot_game_rewards to service_role;

create or replace function public.reserve_cofre_reward(
  p_message_id text,
  p_player_id uuid,
  p_claim_date date,
  p_usage_count integer,
  p_max_usage integer,
  p_reward_gold integer,
  p_result_summary text
)
returns table (
  status text,
  reservation_id uuid,
  reward_gold integer,
  usage_after integer,
  result_summary text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.bot_game_rewards%rowtype;
  v_current_usage integer := 0;
  v_usage_after integer;
  v_reservation_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if nullif(trim(p_message_id), '') is null
    or p_player_id is null
    or p_usage_count <= 0
    or p_max_usage <= 0
    or p_reward_gold < 0
    or nullif(trim(p_result_summary), '') is null then
    raise exception 'Invalid cofre reservation input' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cofre:' || p_player_id::text || ':' || p_claim_date::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('cofre-message:' || p_message_id, 0));

  select reward.* into v_existing
  from public.bot_game_rewards reward
  where reward.source_message_id = p_message_id;

  if found then
    if v_existing.player_id <> p_player_id or v_existing.game_type <> 'cofre' then
      raise exception 'Message idempotency key reused with different data' using errcode = '22023';
    end if;
    select coalesce(claim.reward_gold, 0) into v_usage_after
    from public.bot_daily_claims claim
    where claim.player_id = p_player_id
      and claim.claim_type = 'cofre_usage'
      and claim.claim_date = p_claim_date;
    return query select
      v_existing.credit_status,
      v_existing.id,
      v_existing.reward_gold,
      coalesce(v_usage_after, v_existing.usage_count),
      v_existing.result_summary;
    return;
  end if;

  select claim.reward_gold into v_current_usage
  from public.bot_daily_claims claim
  where claim.player_id = p_player_id
    and claim.claim_type = 'cofre_usage'
    and claim.claim_date = p_claim_date
  for update;
  v_current_usage := coalesce(v_current_usage, 0);
  v_usage_after := v_current_usage + p_usage_count;

  if v_usage_after > p_max_usage then
    return query select 'limit'::text, null::uuid, 0, v_current_usage, ''::text;
    return;
  end if;

  insert into public.bot_daily_claims (
    player_id,
    claim_type,
    claim_date,
    reward_gold
  ) values (
    p_player_id,
    'cofre_usage',
    p_claim_date,
    v_usage_after
  )
  on conflict (player_id, claim_type, claim_date)
  do update set reward_gold = excluded.reward_gold;

  insert into public.bot_game_rewards (
    source_message_id,
    player_id,
    game_type,
    usage_count,
    reward_gold,
    result_summary
  ) values (
    trim(p_message_id),
    p_player_id,
    'cofre',
    p_usage_count,
    p_reward_gold,
    trim(p_result_summary)
  ) returning id into v_reservation_id;

  return query select
    'pending'::text,
    v_reservation_id,
    p_reward_gold,
    v_usage_after,
    trim(p_result_summary);
end;
$$;

create or replace function public.mark_game_reward_credited(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  update public.bot_game_rewards
  set credit_status = 'credited',
      credited_at = coalesce(credited_at, timezone('utc', now()))
  where id = p_reservation_id;
  return found;
end;
$$;

revoke all on function public.reserve_cofre_reward(text, uuid, date, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public.mark_game_reward_credited(uuid) from public, anon, authenticated;
grant execute on function public.reserve_cofre_reward(text, uuid, date, integer, integer, integer, text) to service_role;
grant execute on function public.mark_game_reward_credited(uuid) to service_role;

commit;
