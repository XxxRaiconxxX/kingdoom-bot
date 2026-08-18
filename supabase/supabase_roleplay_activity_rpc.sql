-- Ejecutar en el Supabase principal despues de supabase_roleplay_access.sql.
-- Registra actividad, auditoria y desbloqueo automatico en una sola transaccion.

begin;

create or replace function public.record_roleplay_activity(
  p_player_ids uuid[],
  p_phone text,
  p_phone_aliases text[],
  p_group_jid text,
  p_actor text,
  p_recorded_at timestamptz default now()
)
returns table (
  player_id uuid,
  automatic_lock_cleared boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access record;
  v_recorded_at timestamptz := coalesce(p_recorded_at, now());
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'bot:roleplay_message');
  v_automatic_lock_cleared boolean;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_player_ids), 0) = 0 then
    raise exception 'At least one player is required' using errcode = '22023';
  end if;
  if p_phone is null or trim(p_phone) !~ '^[0-9]{7,15}$' then
    raise exception 'Invalid primary phone' using errcode = '22023';
  end if;
  if length(v_actor) > 128 or length(coalesce(p_group_jid, '')) > 128 then
    raise exception 'Roleplay metadata is too long' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_player_ids) requested(player_id)
    where not exists (
      select 1
      from public.player_roleplay_access access
      where access.player_id = requested.player_id
    )
  ) then
    raise exception 'Roleplay access row is missing' using errcode = 'P0002';
  end if;

  insert into public.roleplay_phone_activity (
    phone,
    last_roleplay_at,
    last_roleplay_group_jid
  )
  select distinct
    trim(alias),
    v_recorded_at,
    nullif(trim(p_group_jid), '')
  from unnest(array_append(coalesce(p_phone_aliases, '{}'::text[]), trim(p_phone))) alias
  where trim(alias) ~ '^[0-9]{7,15}$'
  on conflict (phone) do update
  set
    last_roleplay_at = excluded.last_roleplay_at,
    last_roleplay_group_jid = excluded.last_roleplay_group_jid;

  for v_access in
    select
      access.player_id,
      access.locked_at,
      access.lock_reason
    from public.player_roleplay_access access
    where access.player_id = any(p_player_ids)
    order by access.player_id
    for update
  loop
    v_automatic_lock_cleared := v_access.locked_at is not null
      and (v_access.lock_reason is null or v_access.lock_reason = 'roleplay_inactive');

    update public.player_roleplay_access access
    set
      last_roleplay_at = v_recorded_at,
      grace_until = null,
      locked_at = case
        when access.locked_at is null
          or access.lock_reason is null
          or access.lock_reason = 'roleplay_inactive'
        then null
        else access.locked_at
      end,
      lock_reason = case
        when access.locked_at is null
          or access.lock_reason is null
          or access.lock_reason = 'roleplay_inactive'
        then null
        else access.lock_reason
      end,
      last_roleplay_group_jid = nullif(trim(p_group_jid), ''),
      last_human_roleplay_phone = trim(p_phone)
    where access.player_id = v_access.player_id;

    insert into public.player_roleplay_access_log (
      player_id,
      phone,
      action,
      details,
      performed_by
    ) values (
      v_access.player_id,
      trim(p_phone),
      'roleplay_detected',
      jsonb_build_object(
        'group_jid', nullif(trim(p_group_jid), ''),
        'phone_alias_count', cardinality(p_phone_aliases),
        'automatic_lock_cleared', v_automatic_lock_cleared
      ),
      v_actor
    );

    if v_automatic_lock_cleared then
      insert into public.player_roleplay_access_log (
        player_id,
        phone,
        action,
        details,
        performed_by
      ) values (
        v_access.player_id,
        trim(p_phone),
        'auto_unlocked',
        jsonb_build_object(
          'reason', 'roleplay_detected',
          'group_jid', nullif(trim(p_group_jid), '')
        ),
        v_actor
      );
    end if;

    player_id := v_access.player_id;
    automatic_lock_cleared := v_automatic_lock_cleared;
    return next;
  end loop;
end;
$$;

revoke all on function public.record_roleplay_activity(uuid[], text, text[], text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_roleplay_activity(uuid[], text, text[], text, text, timestamptz)
  to service_role;

comment on function public.record_roleplay_activity(uuid[], text, text[], text, text, timestamptz)
  is 'Registra actividad de roleplay y solo elimina bloqueos automaticos por inactividad.';

commit;
