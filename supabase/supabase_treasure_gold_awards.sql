-- Ejecutar en el Supabase principal, donde viven public.players y el oro.

create extension if not exists pgcrypto;

create table if not exists public.bot_gold_awards (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_ref text not null,
  player_id uuid not null references public.players(id) on delete cascade,
  reward_gold integer not null check (reward_gold > 0),
  balance_after numeric not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (source, external_ref)
);

alter table public.bot_gold_awards enable row level security;
revoke all on table public.bot_gold_awards from public;
revoke all on table public.bot_gold_awards from anon, authenticated;
grant select on table public.bot_gold_awards to service_role;

create index if not exists idx_bot_gold_awards_player_created
  on public.bot_gold_awards (player_id, created_at desc);

create or replace function public.award_bot_gold_once(
  p_player_id uuid,
  p_reward_gold integer,
  p_source text,
  p_external_ref text
)
returns table (
  applied boolean,
  reward_gold integer,
  current_gold numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.bot_gold_awards%rowtype;
  v_current_gold numeric;
begin
  if p_reward_gold <= 0 or nullif(trim(p_source), '') is null or nullif(trim(p_external_ref), '') is null then
    raise exception 'Invalid idempotent gold award input';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_source || ':' || p_external_ref, 0));

  select award.*
  into v_existing
  from public.bot_gold_awards as award
  where award.source = p_source
    and award.external_ref = p_external_ref;

  if found then
    if v_existing.player_id <> p_player_id or v_existing.reward_gold <> p_reward_gold then
      raise exception 'Gold award idempotency key reused with different data';
    end if;
    return query select false, v_existing.reward_gold, v_existing.balance_after;
    return;
  end if;

  update public.players
  set gold = coalesce(gold, 0) + p_reward_gold,
      weekly_gold = coalesce(weekly_gold, 0) + p_reward_gold
  where id = p_player_id
  returning gold into v_current_gold;

  if not found then
    raise exception 'Player not found for gold award';
  end if;

  insert into public.bot_gold_awards (
    source,
    external_ref,
    player_id,
    reward_gold,
    balance_after
  ) values (
    p_source,
    p_external_ref,
    p_player_id,
    p_reward_gold,
    v_current_gold
  );

  return query select true, p_reward_gold, v_current_gold;
end;
$$;

revoke all on function public.award_bot_gold_once(uuid, integer, text, text) from public;
revoke all on function public.award_bot_gold_once(uuid, integer, text, text) from anon, authenticated;
grant execute on function public.award_bot_gold_once(uuid, integer, text, text) to service_role;
