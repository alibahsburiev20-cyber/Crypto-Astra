-- Fix dead-end economy: fuel never regenerated, coins were never earned,
-- and cargo rewards were capped so Galaxy paid the same as Titan.

alter table public.player_wallets
  add column if not exists fuel_updated_at timestamptz not null default now();

create or replace function private.fuel_max() returns integer
language sql immutable set search_path = '' as 'select 5';

create or replace function private.fuel_regen_minutes() returns integer
language sql immutable set search_path = '' as 'select 15';

revoke all on function private.fuel_max() from public, anon, authenticated;
revoke all on function private.fuel_regen_minutes() from public, anon, authenticated;

create or replace function private.refill_fuel(p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_max integer := private.fuel_max();
  v_regen interval := make_interval(mins => private.fuel_regen_minutes());
  v_fuel integer;
  v_at timestamptz;
  v_gain integer;
  v_new_at timestamptz;
begin
  select fuel, fuel_updated_at into v_fuel, v_at
    from public.player_wallets where user_id = p_user for update;
  if not found then return 0; end if;
  if v_fuel >= v_max then
    update public.player_wallets set fuel_updated_at = now() where user_id = p_user;
    return v_fuel;
  end if;
  v_gain := greatest(0, least(v_max - v_fuel,
    floor(extract(epoch from (now() - v_at)) / extract(epoch from v_regen))::integer));
  if v_gain > 0 then
    v_new_at := case when v_fuel + v_gain >= v_max then now() else v_at + v_gain * v_regen end;
    update public.player_wallets
       set fuel = fuel + v_gain, fuel_updated_at = v_new_at, updated_at = now()
     where user_id = p_user;
    insert into public.wallet_ledger(user_id, currency, amount, reason, idempotency_key, metadata)
    values (p_user, 'FUEL', v_gain, 'fuel_regen',
            'fuel_regen:' || ((extract(epoch from v_new_at) * 1000)::bigint)::text,
            jsonb_build_object('gain', v_gain));
  end if;
  return v_fuel + v_gain;
end; $$;
revoke all on function private.refill_fuel(uuid) from public, anon, authenticated;

create or replace function public.sync_player_wallet() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_fuel integer; v_at timestamptz;
begin
  if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
  v_fuel := private.refill_fuel(v_user);
  select fuel_updated_at into v_at from public.player_wallets where user_id = v_user;
  return jsonb_build_object(
    'ok', true, 'fuel', v_fuel,
    'max_fuel', private.fuel_max(),
    'regen_minutes', private.fuel_regen_minutes(),
    'next_fuel_at', case when v_fuel < private.fuel_max()
      then v_at + make_interval(mins => private.fuel_regen_minutes()) end);
end; $$;
revoke all on function public.sync_player_wallet() from public, anon;
grant execute on function public.sync_player_wallet() to authenticated;

create or replace function public.launch_expedition(p_player_rocket_id uuid, p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_rocket public.rocket_catalog%rowtype; v_wallet public.player_wallets%rowtype; v_expedition_id uuid; v_started timestamptz:=now(); v_ends timestamptz;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_idempotency_key is null or char_length(p_idempotency_key)<8 or char_length(p_idempotency_key)>128 then raise exception 'Invalid idempotency key' using errcode='22023'; end if;
 if exists(select 1 from public.wallet_ledger where user_id=v_user and idempotency_key=p_idempotency_key) then return jsonb_build_object('ok',true,'replayed',true); end if;
 select c.* into v_rocket from public.player_rockets pr join public.rocket_catalog c on c.id=pr.rocket_id where pr.id=p_player_rocket_id and pr.user_id=v_user;
 if not found then raise exception 'Rocket not owned' using errcode='P0002'; end if;
 if exists(select 1 from public.expeditions where player_rocket_id=p_player_rocket_id and status='in_progress') then raise exception 'Rocket is already on an expedition' using errcode='P0001'; end if;
 perform private.refill_fuel(v_user);
 select * into v_wallet from public.player_wallets where user_id=v_user for update;
 if v_wallet.fuel<1 then raise exception 'Not enough fuel' using errcode='P0001'; end if;
 v_ends:=v_started+make_interval(mins=>v_rocket.duration_minutes);
 update public.player_wallets set fuel=fuel-1,updated_at=now() where user_id=v_user;
 insert into public.wallet_ledger(user_id,currency,amount,reason,idempotency_key,metadata) values(v_user,'FUEL',-1,'expedition_launch',p_idempotency_key,jsonb_build_object('player_rocket_id',p_player_rocket_id));
 insert into public.expeditions(user_id,player_rocket_id,started_at,ends_at) values(v_user,p_player_rocket_id,v_started,v_ends) returning id into v_expedition_id;
 return jsonb_build_object('ok',true,'expedition_id',v_expedition_id,'started_at',v_started,'ends_at',v_ends);
end; $$;

create or replace function public.complete_expedition(p_expedition_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid:=auth.uid(); v_exp public.expeditions%rowtype; v_capacity integer; v_resource public.resource_catalog%rowtype; v_quantity integer; v_coins bigint; v_xp integer:=10; v_new_xp integer; v_new_level integer; v_reward jsonb;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into v_exp from public.expeditions where id=p_expedition_id and user_id=v_user for update;
 if not found then raise exception 'Expedition not found' using errcode='P0002'; end if;
 if v_exp.status='completed' then return jsonb_build_object('ok',true,'replayed',true,'reward',v_exp.reward_payload); end if;
 if v_exp.status<>'in_progress' then raise exception 'Expedition is not active' using errcode='P0001'; end if;
 if now()<v_exp.ends_at then raise exception 'Expedition is not finished yet' using errcode='P0001'; end if;
 select c.cargo_capacity into v_capacity from public.player_rockets pr join public.rocket_catalog c on c.id=pr.rocket_id where pr.id=v_exp.player_rocket_id and pr.user_id=v_user;
 select * into v_resource from public.resource_catalog order by random() limit 1;
 v_quantity:=greatest(1,floor(v_capacity::numeric/10)::integer);
 v_coins:=v_capacity::bigint*10;
 insert into public.player_inventory(user_id,resource_id,quantity) values(v_user,v_resource.id,v_quantity)
 on conflict(user_id,resource_id) do update set quantity=public.player_inventory.quantity+excluded.quantity,updated_at=now();
 update public.player_wallets set astra_coins=astra_coins+v_coins,xp=xp+v_xp,level=((xp+v_xp)/100)+1,updated_at=now() where user_id=v_user returning xp,level into v_new_xp,v_new_level;
 insert into public.wallet_ledger(user_id,currency,amount,reason,idempotency_key,metadata) values(v_user,'ASTRA_COINS',v_coins,'expedition_reward','expedition:'||p_expedition_id::text||':coins',jsonb_build_object('expedition_id',p_expedition_id));
 insert into public.wallet_ledger(user_id,currency,amount,reason,idempotency_key,metadata) values(v_user,'XP',v_xp,'expedition_complete','expedition:'||p_expedition_id::text||':complete',jsonb_build_object('expedition_id',p_expedition_id));
 v_reward:=jsonb_build_object('resource_id',v_resource.id,'resource_name',v_resource.display_name,'quantity',v_quantity,'xp',v_xp,'coins',v_coins);
 update public.expeditions set status='completed',completed_at=now(),reward_payload=v_reward where id=p_expedition_id;
 return jsonb_build_object('ok',true,'reward',v_reward,'xp_total',v_new_xp,'level',v_new_level);
end; $$;

revoke all on function public.launch_expedition(uuid,text) from public, anon;
revoke all on function public.complete_expedition(uuid) from public, anon;
grant execute on function public.launch_expedition(uuid,text) to authenticated;
grant execute on function public.complete_expedition(uuid) to authenticated;
