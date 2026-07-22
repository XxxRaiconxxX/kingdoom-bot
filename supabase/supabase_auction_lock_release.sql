-- Ejecutar en el Supabase principal.
-- Alinea la implementacion con el contrato publicado: comision unica del 25%
-- y bloqueo/reembolso de la puja acumulada.

begin;

do $$
begin
  if exists (select 1 from public.market_auctions where status = 'active') then
    raise exception 'Close or cancel active auctions before applying lock-and-release migration';
  end if;
end;
$$;

alter table public.market_auction_participants
  add column if not exists entry_fee_paid integer not null default 0,
  add column if not exists locked_amount integer not null default 0,
  add column if not exists released_at timestamptz,
  add column if not exists settled_at timestamptz;

alter table public.market_auction_participants
  drop constraint if exists market_auction_participants_entry_fee_paid_check,
  drop constraint if exists market_auction_participants_locked_amount_check;

alter table public.market_auction_participants
  add constraint market_auction_participants_entry_fee_paid_check check (entry_fee_paid >= 0),
  add constraint market_auction_participants_locked_amount_check check (locked_amount >= 0);

create or replace function public.place_auction_bid(
  p_player_id uuid,
  p_auction_id uuid,
  p_amount integer
)
returns table (
  auction_id uuid,
  highest_bid integer,
  highest_bidder_id uuid,
  remaining_gold integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_auction public.market_auctions%rowtype;
  v_participant public.market_auction_participants%rowtype;
  v_previous_participant public.market_auction_participants%rowtype;
  v_min_bid integer;
  v_entry_fee integer;
  v_fee_to_charge integer := 0;
  v_lock_delta integer;
  v_required_gold integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'La puja debe ser un entero positivo.' using errcode = '22023';
  end if;

  if auth.role() <> 'service_role' then
    if auth.role() <> 'authenticated' or auth.uid() is null or not exists (
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
      raise exception 'No tienes permiso para pujar por este jugador.' using errcode = '42501';
    end if;
  end if;

  select * into v_auction
  from public.market_auctions
  where id = p_auction_id
  for update;

  if not found then
    raise exception 'La subasta no existe.' using errcode = 'P0002';
  end if;
  if v_auction.status <> 'active' or v_auction.expires_at <= now() then
    raise exception 'La subasta no esta activa.' using errcode = '22023';
  end if;

  v_min_bid := case
    when v_auction.highest_bid = 0 then v_auction.start_price
    else v_auction.highest_bid + v_auction.min_increment
  end;
  if p_amount < v_min_bid then
    raise exception 'La puja debe ser de al menos % de oro.', v_min_bid using errcode = '22023';
  end if;

  select * into v_player
  from public.players
  where id = p_player_id
  for update;
  if not found then
    raise exception 'El jugador no existe.' using errcode = 'P0002';
  end if;

  select * into v_participant
  from public.market_auction_participants participant
  where participant.auction_id = p_auction_id and participant.player_id = p_player_id
  for update;

  if not found then
    v_entry_fee := (greatest(v_auction.start_price, 0) + 3) / 4;
    v_fee_to_charge := v_entry_fee;
    insert into public.market_auction_participants (
      auction_id,
      player_id,
      has_withdrawn,
      entry_fee_paid,
      locked_amount
    ) values (
      p_auction_id,
      p_player_id,
      false,
      v_entry_fee,
      0
    )
    returning * into v_participant;
  elsif v_participant.has_withdrawn then
    raise exception 'Te has retirado de esta subasta y no puedes volver a pujar.' using errcode = '22023';
  end if;

  if v_participant.locked_amount > p_amount then
    raise exception 'La puja no puede reducir un bloqueo existente.' using errcode = '22023';
  end if;

  v_lock_delta := p_amount - v_participant.locked_amount;
  v_required_gold := v_fee_to_charge + v_lock_delta;
  if v_player.gold < v_required_gold then
    raise exception 'No tienes suficiente oro: se requieren % y tienes %.', v_required_gold, v_player.gold using errcode = '22023';
  end if;

  if v_auction.highest_bidder_id is not null and v_auction.highest_bidder_id <> p_player_id then
    select * into v_previous_participant
    from public.market_auction_participants participant
    where participant.auction_id = p_auction_id
      and participant.player_id = v_auction.highest_bidder_id
    for update;

    if not found or v_previous_participant.locked_amount <> v_auction.highest_bid then
      raise exception 'Auction lock state is inconsistent; bid was not applied' using errcode = 'P0001';
    end if;

    update public.players
    set gold = gold + v_previous_participant.locked_amount
    where id = v_auction.highest_bidder_id;

    update public.market_auction_participants participant
    set locked_amount = 0,
        released_at = now()
    where participant.auction_id = p_auction_id
      and participant.player_id = v_auction.highest_bidder_id;
  end if;

  update public.players
  set gold = gold - v_required_gold
  where id = p_player_id;

  update public.market_auction_participants participant
  set locked_amount = p_amount,
      released_at = null,
      settled_at = null
  where participant.auction_id = p_auction_id and participant.player_id = p_player_id;

  insert into public.market_auction_bids (auction_id, player_id, amount)
  values (p_auction_id, p_player_id, p_amount);

  update public.market_auctions
  set highest_bid = p_amount,
      highest_bidder_id = p_player_id
  where id = p_auction_id;

  return query select
    p_auction_id,
    p_amount,
    p_player_id,
    v_player.gold - v_required_gold;
end;
$$;

create or replace function public.resolve_market_auction(p_auction_id uuid)
returns table (
  auction_id uuid,
  status text,
  winner_id uuid,
  item_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.market_auctions%rowtype;
  v_is_admin boolean := false;
  v_existing_inventory public.player_inventory%rowtype;
  v_item_id text;
  v_winner_lock integer := 0;
begin
  select * into v_auction
  from public.market_auctions
  where id = p_auction_id
  for update;

  if not found then
    raise exception 'La subasta no existe.' using errcode = 'P0002';
  end if;
  if v_auction.status <> 'active' then
    raise exception 'La subasta ya no esta activa.' using errcode = '22023';
  end if;

  if auth.role() = 'service_role' then
    v_is_admin := true;
  elsif auth.role() = 'authenticated' and auth.uid() is not null then
    select coalesce(bool_or(is_admin), false)
      into v_is_admin
    from public.players
    where auth_user_id = auth.uid();
  end if;

  if not v_is_admin and v_auction.expires_at > now() then
    raise exception 'La subasta aun no ha terminado.' using errcode = '22023';
  end if;

  if v_auction.highest_bidder_id is not null then
    select locked_amount into v_winner_lock
    from public.market_auction_participants participant
    where participant.auction_id = p_auction_id
      and participant.player_id = v_auction.highest_bidder_id
    for update;

    if not found or v_winner_lock <> v_auction.highest_bid then
      raise exception 'Auction winner lock is inconsistent; resolution stopped' using errcode = 'P0001';
    end if;
  end if;

  update public.players p
  set gold = p.gold + refunds.amount
  from (
    select player_id, sum(locked_amount)::integer as amount
    from public.market_auction_participants participant
    where participant.auction_id = p_auction_id
      and participant.locked_amount > 0
      and participant.player_id is distinct from v_auction.highest_bidder_id
    group by participant.player_id
  ) refunds
  where p.id = refunds.player_id;

  update public.market_auction_participants participant
  set locked_amount = 0,
      released_at = case
        when participant.player_id is distinct from v_auction.highest_bidder_id then now()
        else released_at
      end,
      settled_at = case
        when participant.player_id = v_auction.highest_bidder_id then now()
        else settled_at
      end
  where participant.auction_id = p_auction_id;

  if v_auction.highest_bidder_id is not null then
    v_item_id := coalesce(v_auction.item_id, v_auction.id::text);

    select * into v_existing_inventory
    from public.player_inventory
    where player_id = v_auction.highest_bidder_id
      and item_id = v_item_id
    limit 1;

    if not found then
      insert into public.player_inventory (
        player_id,
        item_id,
        item_name,
        item_category,
        item_description,
        item_rarity,
        item_image_url,
        quantity,
        is_locked
      ) values (
        v_auction.highest_bidder_id,
        v_item_id,
        v_auction.item_name,
        v_auction.item_category,
        v_auction.item_description,
        v_auction.item_rarity,
        coalesce(v_auction.item_image_url, ''),
        1,
        false
      );
    else
      update public.player_inventory
      set quantity = v_existing_inventory.quantity + 1,
          updated_at = now()
      where id = v_existing_inventory.id;
    end if;

    insert into public.market_orders (
      player_id,
      item_id,
      item_name,
      item_category,
      quantity,
      unit_price,
      total_price,
      whatsapp,
      order_ref,
      status
    ) values (
      v_auction.highest_bidder_id,
      v_item_id,
      v_auction.item_name,
      v_auction.item_category,
      1,
      v_auction.highest_bid,
      v_auction.highest_bid,
      'subasta',
      'AUC-' || substring(v_auction.id::text from 1 for 8),
      'completed'
    );

    insert into public.player_notifications (
      player_id,
      sender_name,
      kind,
      title,
      message,
      amount,
      item_name
    ) values (
      v_auction.highest_bidder_id,
      'Subasta',
      'item',
      'Subasta ganada',
      'Has ganado la subasta de ' || v_auction.item_name || ' con una puja de ' || v_auction.highest_bid || ' de oro.',
      v_auction.highest_bid,
      v_auction.item_name
    );
  end if;

  update public.market_auctions
  set status = 'completed',
      closed_at = now()
  where id = p_auction_id;

  return query select
    p_auction_id,
    'completed'::text,
    v_auction.highest_bidder_id,
    v_auction.item_name;
end;
$$;

revoke all on function public.place_auction_bid(uuid, uuid, integer) from public, anon;
revoke all on function public.resolve_market_auction(uuid) from public, anon;
grant execute on function public.place_auction_bid(uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.resolve_market_auction(uuid) to authenticated, service_role;

commit;
