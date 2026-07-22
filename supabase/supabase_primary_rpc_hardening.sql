-- Ejecutar en el Supabase principal.
-- Cierra RPC SECURITY DEFINER para anon y valida autorizacion antes de tocar oro.
-- increment_gold conserva authenticated sobre el jugador vinculado porque la web aun
-- liquida minijuegos en cliente; retirar ese permiso requiere migrar primero Kingdoom-sync.

begin;

create or replace function public.increment_gold(
  p_player_id uuid,
  p_amount integer
)
returns table (
  success boolean,
  message text,
  new_gold integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_actor_is_admin boolean := false;
begin
  if p_amount is null or p_amount = 0 then
    raise exception 'Invalid gold amount' using errcode = '22023';
  end if;

  if auth.role() <> 'service_role' then
    if auth.role() <> 'authenticated' or auth.uid() is null then
      raise exception 'Authentication required' using errcode = '42501';
    end if;

    select coalesce(bool_or(p.is_admin), false)
      into v_actor_is_admin
    from public.players p
    where p.auth_user_id = auth.uid();

    if not v_actor_is_admin and not exists (
      select 1
      from public.players p
      where p.id = p_player_id
        and (
          p.auth_user_id = auth.uid()
          or exists (
            select 1
            from public.player_auth_links pal
            where pal.player_id = p_player_id
              and pal.auth_user_id = auth.uid()
          )
        )
    ) then
      raise exception 'Not allowed to update this player' using errcode = '42501';
    end if;
  end if;

  select *
    into v_player
  from public.players
  where id = p_player_id
  for update;

  if not found then
    return query select false, 'Jugador no encontrado.', 0;
    return;
  end if;

  if p_amount < 0 and v_player.gold < abs(p_amount) then
    return query select false, 'Oro insuficiente.', v_player.gold;
    return;
  end if;

  update public.players
  set gold = gold + p_amount
  where id = p_player_id
  returning gold into v_player.gold;

  return query select
    true,
    case when p_amount >= 0 then 'Oro anadido correctamente.' else 'Oro descontado correctamente.' end,
    v_player.gold;
end;
$$;

create or replace function public.place_bet(
  p_player_id uuid,
  p_amount numeric,
  p_game_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_gold integer;
  v_bet_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount > 2147483647 then
    raise exception 'Invalid bet amount' using errcode = '22023';
  end if;
  if nullif(trim(p_game_type), '') is null or length(p_game_type) > 64 then
    raise exception 'Invalid game type' using errcode = '22023';
  end if;

  select gold into v_current_gold
  from public.players
  where id = p_player_id
  for update;

  if not found then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;
  if v_current_gold < p_amount then
    raise exception 'Insufficient gold' using errcode = '22023';
  end if;

  update public.players
  set gold = gold - p_amount::integer
  where id = p_player_id;

  insert into public.bot_active_bets (player_id, amount, game_type, resolved)
  values (p_player_id, p_amount, trim(p_game_type), false)
  returning id into v_bet_id;

  return v_bet_id;
end;
$$;

create or replace function public.resolve_bet(
  p_bet_id uuid,
  p_payout numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet public.bot_active_bets%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_payout is null or p_payout < 0 or p_payout <> trunc(p_payout) or p_payout > 2147483647 then
    raise exception 'Invalid payout' using errcode = '22023';
  end if;

  select * into v_bet
  from public.bot_active_bets
  where id = p_bet_id
  for update;

  if not found then
    raise exception 'Bet not found' using errcode = 'P0002';
  end if;
  if v_bet.resolved then
    raise exception 'Bet already resolved' using errcode = '22023';
  end if;

  update public.bot_active_bets
  set resolved = true
  where id = p_bet_id;

  if p_payout > 0 then
    update public.players
    set gold = gold + p_payout::integer
    where id = v_bet.player_id;
  end if;

  return true;
end;
$$;

-- Variante temporal heredada con cuatro argumentos DEFAULT que vuelve ambigua
-- cualquier llamada PostgREST de dos argumentos.
drop function if exists public.increment_gold(uuid, integer, uuid, integer);

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure::text as signature, p.proargnames
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'increment_gold'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function.signature);
    execute format('grant execute on function %s to service_role', v_function.signature);
    if v_function.proargnames[1:2] = array['p_player_id', 'p_amount'] then
      execute format('grant execute on function %s to authenticated', v_function.signature);
    end if;
  end loop;
end;
$$;

revoke all on function public.place_bet(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.resolve_bet(uuid, numeric) from public, anon, authenticated;
grant execute on function public.place_bet(uuid, numeric, text) to service_role;
grant execute on function public.resolve_bet(uuid, numeric) to service_role;

revoke all on function public.transfer_player_gold(uuid, uuid, integer) from public, anon;
grant execute on function public.transfer_player_gold(uuid, uuid, integer) to authenticated, service_role;

revoke all on function public.create_market_auction(text, text, text, text, text, text, integer, integer, integer, text) from public, anon;
revoke all on function public.place_auction_bid(uuid, uuid, integer) from public, anon;
revoke all on function public.withdraw_from_auction(uuid, uuid) from public, anon;
revoke all on function public.resolve_market_auction(uuid) from public, anon;
grant execute on function public.create_market_auction(text, text, text, text, text, text, integer, integer, integer, text) to authenticated, service_role;
grant execute on function public.place_auction_bid(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.withdraw_from_auction(uuid, uuid) to authenticated, service_role;
grant execute on function public.resolve_market_auction(uuid) to authenticated, service_role;

revoke all on function public.award_manual_mission_rank_points(uuid[], text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.assign_recycled_character_sheet(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.process_market_installments() from public, anon, authenticated;
grant execute on function public.award_manual_mission_rank_points(uuid[], text, text, text, text, text) to service_role;
grant execute on function public.assign_recycled_character_sheet(uuid, uuid, text) to service_role;
grant execute on function public.process_market_installments() to service_role;

commit;
