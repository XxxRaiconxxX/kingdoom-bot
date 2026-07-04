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

-- Enable RLS and add policies for bot operational tables
alter table public.bot_daily_claims enable row level security;
create policy "Allow service_role full access bot_daily_claims" on public.bot_daily_claims for all using (auth.role() = 'service_role');

alter table public.bot_active_missions enable row level security;
create policy "Allow service_role full access bot_active_missions" on public.bot_active_missions for all using (auth.role() = 'service_role');

alter table public.bot_treasure_events enable row level security;
create policy "Allow service_role full access bot_treasure_events" on public.bot_treasure_events for all using (auth.role() = 'service_role');

alter table public.bot_treasure_claims enable row level security;
create policy "Allow service_role full access bot_treasure_claims" on public.bot_treasure_claims for all using (auth.role() = 'service_role');

alter table public.bot_notifications_queue enable row level security;
create policy "Allow service_role full access bot_notifications_queue" on public.bot_notifications_queue for all using (auth.role() = 'service_role');

alter table public.bot_command_logs enable row level security;
create policy "Allow service_role full access bot_command_logs" on public.bot_command_logs for all using (auth.role() = 'service_role');
