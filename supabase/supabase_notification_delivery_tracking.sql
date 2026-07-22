-- Ejecutar en el Supabase dedicado del bot.
-- Conserva la identidad del mensaje saliente para reconciliar ACK tardios sin duplicar envios.

alter table public.bot_notifications_queue
  add column if not exists delivery_message_id text,
  add column if not exists delivery_started_at timestamptz,
  add column if not exists delivery_attempts integer not null default 0,
  add column if not exists delivery_error text;

alter table public.bot_notifications_queue
  drop constraint if exists bot_notifications_queue_delivery_attempts_check;

alter table public.bot_notifications_queue
  add constraint bot_notifications_queue_delivery_attempts_check
  check (delivery_attempts >= 0);

create index if not exists idx_bot_notifications_queue_delivery_pending
  on public.bot_notifications_queue (delivery_started_at)
  where sent = false and delivery_message_id is not null;
