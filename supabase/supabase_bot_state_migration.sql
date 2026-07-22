-- Kingdoom Bot - Supabase dedicado para estado operativo
-- Ejecutar en el proyecto Supabase exclusivo del bot.

create extension if not exists pgcrypto;

create table if not exists public.bot_daily_claims (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null,
  claim_type text not null,
  claim_date date not null,
  reward_gold integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  unique (player_id, claim_type, claim_date)
);

create index if not exists idx_bot_daily_claims_player_date
  on public.bot_daily_claims (player_id, claim_date desc);

create index if not exists idx_bot_daily_claims_type_date
  on public.bot_daily_claims (claim_type, claim_date desc);

create table if not exists public.bot_active_missions (
  instance_id uuid primary key default gen_random_uuid(),
  short_id text not null,
  mission_id text,
  title text,
  instructions text,
  gm_config jsonb,
  max_participants integer not null default 1,
  player_message_count integer not null default 0,
  gm_round_count integer not null default 0,
  context jsonb,
  participants jsonb not null default '[]'::jsonb,
  participants_counted jsonb not null default '[]'::jsonb,
  resolved boolean not null default false,
  final_state jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_bot_active_missions_resolved
  on public.bot_active_missions (resolved, updated_at desc);

create index if not exists idx_bot_active_missions_lookup
  on public.bot_active_missions (short_id, resolved);

create or replace function public.set_bot_active_missions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_bot_active_missions_updated_at on public.bot_active_missions;

create trigger trg_bot_active_missions_updated_at
before update on public.bot_active_missions
for each row
execute function public.set_bot_active_missions_updated_at();

-- ETAPA A: Nuevas tablas (Tesoros, Notificaciones, Analiticas)

create table if not exists public.bot_treasure_events (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  message_id text unique not null,
  max_winners integer not null default 1,
  status text not null default 'open',
  expires_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.bot_treasure_claims (
  id uuid primary key default gen_random_uuid(),
  event_message_id text not null references public.bot_treasure_events(message_id) on delete cascade,
  player_id uuid not null,
  reward_gold integer not null,
  claimed_at timestamptz not null default timezone('utc', now()),
  unique (event_message_id, player_id)
);

alter table public.bot_treasure_claims
  add column if not exists credit_status text,
  add column if not exists credited_at timestamptz;

update public.bot_treasure_claims
set credit_status = 'credited',
    credited_at = coalesce(credited_at, claimed_at)
where credit_status is null;

alter table public.bot_treasure_claims
  alter column credit_status set default 'pending',
  alter column credit_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bot_treasure_claims_credit_status_check'
      and conrelid = 'public.bot_treasure_claims'::regclass
  ) then
    alter table public.bot_treasure_claims
      add constraint bot_treasure_claims_credit_status_check
      check (credit_status in ('pending', 'credited'));
  end if;
end;
$$;

create or replace function public.reserve_treasure_claim(
  p_message_id text,
  p_player_id uuid,
  p_chat_id text,
  p_reward_gold integer
)
returns table (
  status text,
  claim_id uuid,
  reward_gold integer,
  winners_count bigint,
  max_winners integer,
  event_status text,
  credit_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.bot_treasure_events%rowtype;
  v_claim public.bot_treasure_claims%rowtype;
  v_winners_count bigint;
begin
  select event.*
  into v_event
  from public.bot_treasure_events as event
  where event.message_id = p_message_id
    and event.chat_id = p_chat_id
  for update;

  if not found then
    return query select 'error', null::uuid, null::integer, 0::bigint, 0, 'missing', 'missing';
    return;
  end if;

  select claim.*
  into v_claim
  from public.bot_treasure_claims as claim
  where claim.event_message_id = p_message_id
    and claim.player_id = p_player_id;

  select count(*)
  into v_winners_count
  from public.bot_treasure_claims as claim
  where claim.event_message_id = p_message_id;

  if found and v_claim.id is not null then
    return query select
      case when v_claim.credit_status = 'credited' then 'duplicate' else 'reserved' end,
      v_claim.id,
      v_claim.reward_gold,
      v_winners_count,
      v_event.max_winners,
      case when v_event.status = 'closed' then 'claimed' else v_event.status end,
      v_claim.credit_status;
    return;
  end if;

  if v_event.status <> 'open' or v_winners_count >= v_event.max_winners then
    return query select 'full', null::uuid, null::integer, v_winners_count,
      v_event.max_winners, 'claimed', 'missing';
    return;
  end if;

  if v_event.expires_at <= timezone('utc', now()) then
    update public.bot_treasure_events
    set status = 'expired', closed_at = timezone('utc', now())
    where id = v_event.id;
    return query select 'expired', null::uuid, null::integer, v_winners_count,
      v_event.max_winners, 'expired', 'missing';
    return;
  end if;

  insert into public.bot_treasure_claims (
    event_message_id,
    player_id,
    reward_gold,
    credit_status
  ) values (
    p_message_id,
    p_player_id,
    greatest(p_reward_gold, 0),
    'pending'
  )
  returning * into v_claim;

  v_winners_count := v_winners_count + 1;
  if v_winners_count >= v_event.max_winners then
    update public.bot_treasure_events
    set status = 'closed', closed_at = timezone('utc', now())
    where id = v_event.id;
  end if;

  return query select
    'reserved',
    v_claim.id,
    v_claim.reward_gold,
    v_winners_count,
    v_event.max_winners,
    case when v_winners_count >= v_event.max_winners then 'claimed' else 'open' end,
    v_claim.credit_status;
end;
$$;

create or replace function public.mark_treasure_claim_credited(p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.bot_treasure_claims
  set credit_status = 'credited',
      credited_at = coalesce(credited_at, timezone('utc', now()))
  where id = p_claim_id;
  return found;
end;
$$;

revoke all on function public.reserve_treasure_claim(text, uuid, text, integer) from public;
revoke all on function public.mark_treasure_claim_credited(uuid) from public;
revoke all on function public.reserve_treasure_claim(text, uuid, text, integer) from anon, authenticated;
revoke all on function public.mark_treasure_claim_credited(uuid) from anon, authenticated;
grant execute on function public.reserve_treasure_claim(text, uuid, text, integer) to service_role;
grant execute on function public.mark_treasure_claim_credited(uuid) to service_role;

create table if not exists public.bot_notifications_queue (
  id uuid primary key default gen_random_uuid(),
  player_phone text not null,
  message text not null,
  sent boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_bot_notifications_queue_unsent
  on public.bot_notifications_queue (sent) where sent = false;

create table if not exists public.bot_command_logs (
  id uuid primary key default gen_random_uuid(),
  player_phone text,
  command text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_bot_command_logs_created
  on public.bot_command_logs (created_at desc);
