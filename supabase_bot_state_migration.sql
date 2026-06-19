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
  short_id text primary key,
  mission_id text,
  title text,
  instructions text,
  gm_config jsonb,
  max_participants integer,
  player_message_count integer not null default 0,
  gm_round_count integer not null default 0,
  context jsonb,
  participants_counted jsonb not null default '[]'::jsonb,
  resolved boolean not null default false,
  final_state jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_bot_active_missions_resolved
  on public.bot_active_missions (resolved, updated_at desc);

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
