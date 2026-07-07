alter table public.players
  add column if not exists lifecycle_status text not null default 'active'
    check (lifecycle_status in ('active', 'left_grace', 'archived', 'recycled', 'purged')),
  add column if not exists left_group_at timestamptz null,
  add column if not exists archive_due_at timestamptz null,
  add column if not exists archived_at timestamptz null,
  add column if not exists reactivated_at timestamptz null,
  add column if not exists recycled_at timestamptz null,
  add column if not exists purged_at timestamptz null,
  add column if not exists last_known_group_jid text null,
  add column if not exists last_exit_reason text null;

create index if not exists idx_players_lifecycle_status_due
  on public.players (lifecycle_status, archive_due_at);

create index if not exists idx_players_phone_lifecycle
  on public.players (phone, lifecycle_status);

create table if not exists public.player_lifecycle_log (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  phone text null,
  group_jid text null,
  action text not null,
  from_status text null,
  to_status text null,
  sheet_id uuid null references public.character_sheets(id) on delete set null,
  performed_by text not null default 'system',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_player_lifecycle_log_player_created
  on public.player_lifecycle_log (player_id, created_at desc);

create index if not exists idx_player_lifecycle_log_action_created
  on public.player_lifecycle_log (action, created_at desc);

-- Enable RLS and add policy
alter table public.player_lifecycle_log enable row level security;
create policy "Allow service_role full access player_lifecycle_log" on public.player_lifecycle_log for all using (auth.role() = 'service_role');
