create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare chosen_name text;
begin
 chosen_name:=nullif(btrim(new.raw_user_meta_data->>'display_name'),'');
 if chosen_name is null or char_length(chosen_name)<2 or char_length(chosen_name)>32 then chosen_name:='Space Pilot'; end if;
 insert into public.profiles(id,display_name) values(new.id,chosen_name) on conflict(id) do nothing;
 insert into public.player_wallets(user_id) values(new.id) on conflict(user_id) do nothing;
 insert into public.player_rockets(user_id,rocket_id,is_active) values(new.id,'scout',true) on conflict(user_id,rocket_id) do nothing;
 insert into public.player_inventory(user_id,resource_id,quantity) select new.id,id,0 from public.resource_catalog on conflict(user_id,resource_id) do nothing;
 return new;
end; $$;
revoke all on function private.handle_new_user() from public,anon,authenticated;
drop trigger if exists on_auth_user_created_crypto_astra on auth.users;
create trigger on_auth_user_created_crypto_astra after insert on auth.users for each row execute function private.handle_new_user();
create or replace function public.purchase_rocket(p_rocket_id text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_rocket public.rocket_catalog%rowtype; v_wallet public.player_wallets%rowtype; v_owned uuid;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_idempotency_key is null or char_length(p_idempotency_key)<8 or char_length(p_idempotency_key)>128 then raise exception 'Invalid idempotency key' using errcode='22023'; end if;
 if exists(select 1 from public.wallet_ledger where user_id=v_user and idempotency_key=p_idempotency_key) then return jsonb_build_object('ok',true,'replayed',true); end if;
 select * into v_rocket from public.rocket_catalog where id=p_rocket_id;
 if not found then raise exception 'Rocket not found' using errcode='P0002'; end if;
 select * into v_wallet from public.player_wallets where user_id=v_user for update;
 if not found then raise exception 'Player wallet not found' using errcode='P0002'; end if;
 select id into v_owned from public.player_rockets where user_id=v_user and rocket_id=p_rocket_id;
 if found then raise exception 'Rocket already owned' using errcode='23505'; end if;
 if v_wallet.astra_coins<v_rocket.price_coins then raise exception 'Not enough ASTRA Coins' using errcode='P0001'; end if;
 update public.player_wallets set astra_coins=astra_coins-v_rocket.price_coins,updated_at=now() where user_id=v_user;
 insert into public.player_rockets(user_id,rocket_id,is_active) values(v_user,p_rocket_id,false);
 if v_rocket.price_coins>0 then insert into public.wallet_ledger(user_id,currency,amount,reason,idempotency_key,metadata) values(v_user,'ASTRA_COINS',-v_rocket.price_coins,'rocket_purchase',p_idempotency_key,jsonb_build_object('rocket_id',p_rocket_id)); end if;
 return jsonb_build_object('ok',true,'rocket_id',p_rocket_id,'coins_spent',v_rocket.price_coins);
end; $$;
create or replace function public.launch_expedition(p_player_rocket_id uuid,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_rocket public.rocket_catalog%rowtype; v_wallet public.player_wallets%rowtype; v_expedition_id uuid; v_started timestamptz:=now(); v_ends timestamptz;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_idempotency_key is null or char_length(p_idempotency_key)<8 or char_length(p_idempotency_key)>128 then raise exception 'Invalid idempotency key' using errcode='22023'; end if;
 if exists(select 1 from public.wallet_ledger where user_id=v_user and idempotency_key=p_idempotency_key) then return jsonb_build_object('ok',true,'replayed',true); end if;
 select c.* into v_rocket from public.player_rockets pr join public.rocket_catalog c on c.id=pr.rocket_id where pr.id=p_player_rocket_id and pr.user_id=v_user;
 if not found then raise exception 'Rocket not owned' using errcode='P0002'; end if;
 if exists(select 1 from public.expeditions where player_rocket_id=p_player_rocket_id and status='in_progress') then raise exception 'Rocket is already on an expedition' using errcode='P0001'; end if;
 select * into v_wallet from public.player_wallets where user_id=v_user for update;
 if v_wallet.fuel<1 then raise exception 'Not enough fuel' using errcode='P0001'; end if;
 v_ends:=v_started+make_interval(mins=>v_rocket.duration_minutes);
 update public.player_wallets set fuel=fuel-1,updated_at=now() where user_id=v_user;
 insert into public.wallet_ledger(user_id,currency,amount,reason,idempotency_key,metadata) values(v_user,'FUEL',-1,'expedition_launch',p_idempotency_key,jsonb_build_object('player_rocket_id',p_player_rocket_id));
 insert into public.expeditions(user_id,player_rocket_id,started_at,ends_at) values(v_user,p_player_rocket_id,v_started,v_ends) returning id into v_expedition_id;
 return jsonb_build_object('ok',true,'expedition_id',v_expedition_id,'started_at',v_started,'ends_at',v_ends);
end; $$;
create or replace function public.complete_expedition(p_expedition_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_user uuid:=auth.uid(); v_exp public.expeditions%rowtype; v_capacity integer; v_resource public.resource_catalog%rowtype; v_quantity integer; v_xp integer:=10; v_new_xp integer; v_new_level integer; v_reward jsonb;
begin
 if v_user is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into v_exp from public.expeditions where id=p_expedition_id and user_id=v_user for update;
 if not found then raise exception 'Expedition not found' using errcode='P0002'; end if;
 if v_exp.status='completed' then return jsonb_build_object('ok',true,'replayed',true,'reward',v_exp.reward_payload); end if;
 if v_exp.status<>'in_progress' then raise exception 'Expedition is not active' using errcode='P0001'; end if;
 if now()<v_exp.ends_at then raise exception 'Expedition is not finished yet' using errcode='P0001'; end if;
 select c.cargo_capacity into v_capacity from public.player_rockets pr join public.rocket_catalog c on c.id=pr.rocket_id where pr.id=v_exp.player_rocket_id and pr.user_id=v_user;
 select * into v_resource from public.resource_catalog order by random() limit 1;
 v_quantity:=greatest(1,least(20,floor(v_capacity::numeric/10)::integer));
 insert into public.player_inventory(user_id,resource_id,quantity) values(v_user,v_resource.id,v_quantity)
 on conflict(user_id,resource_id) do update set quantity=public.player_inventory.quantity+excluded.quantity,updated_at=now();
 update public.player_wallets set xp=xp+v_xp,level=((xp+v_xp)/100)+1,updated_at=now() where user_id=v_user returning xp,level into v_new_xp,v_new_level;
 insert into public.wallet_ledger(user_id,currency,amount,reason,idempotency_key,metadata) values(v_user,'XP',v_xp,'expedition_complete','expedition:'||p_expedition_id::text||':complete',jsonb_build_object('expedition_id',p_expedition_id));
 v_reward:=jsonb_build_object('resource_id',v_resource.id,'resource_name',v_resource.display_name,'quantity',v_quantity,'xp',v_xp);
 update public.expeditions set status='completed',completed_at=now(),reward_payload=v_reward where id=p_expedition_id;
 return jsonb_build_object('ok',true,'reward',v_reward,'xp_total',v_new_xp,'level',v_new_level);
end; $$;
revoke all on function public.purchase_rocket(text,text) from public,anon;
revoke all on function public.launch_expedition(uuid,text) from public,anon;
revoke all on function public.complete_expedition(uuid) from public,anon;
grant execute on function public.purchase_rocket(text,text) to authenticated;
grant execute on function public.launch_expedition(uuid,text) to authenticated;
grant execute on function public.complete_expedition(uuid) to authenticated;