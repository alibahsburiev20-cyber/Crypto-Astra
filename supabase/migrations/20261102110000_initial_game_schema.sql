
create table public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default 'Space Pilot' check (char_length(display_name) between 2 and 32),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.player_wallets (
 user_id uuid primary key references auth.users(id) on delete cascade,
 astra_coins bigint not null default 500 check (astra_coins >= 0),
 fuel integer not null default 3 check (fuel >= 0),
 xp integer not null default 0 check (xp >= 0),
 level integer not null default 1 check (level >= 1),
 updated_at timestamptz not null default now()
);
create table public.rocket_catalog (
 id text primary key, display_name text not null,
 price_coins bigint not null check (price_coins >= 0),
 duration_minutes integer not null check (duration_minutes > 0),
 cargo_capacity integer not null check (cargo_capacity > 0),
 description text not null, sort_order integer not null unique
);
create table public.resource_catalog (
 id text primary key, display_name text not null, icon text not null, sort_order integer not null unique
);
create table public.player_rockets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 rocket_id text not null references public.rocket_catalog(id),
 purchased_at timestamptz not null default now(), is_active boolean not null default false,
 unique (user_id, rocket_id)
);
create unique index player_rockets_one_active_per_user on public.player_rockets(user_id) where is_active=true;
create table public.player_inventory (
 user_id uuid not null references auth.users(id) on delete cascade,
 resource_id text not null references public.resource_catalog(id),
 quantity bigint not null default 0 check (quantity >= 0),
 updated_at timestamptz not null default now(), primary key (user_id,resource_id)
);
create table public.expeditions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 player_rocket_id uuid not null references public.player_rockets(id),
 status text not null default 'in_progress' check(status in ('in_progress','completed','cancelled')),
 started_at timestamptz not null default now(), ends_at timestamptz not null,
 completed_at timestamptz, reward_payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 check(ends_at>started_at), check(status<>'completed' or completed_at is not null)
);
create index expeditions_user_status_idx on public.expeditions(user_id,status);
create index expeditions_due_idx on public.expeditions(ends_at) where status='in_progress';
create table public.wallet_ledger (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 currency text not null check(currency in ('ASTRA_COINS','FUEL','XP')),
 amount bigint not null check(amount<>0), reason text not null,
 idempotency_key text not null, metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), unique(user_id,idempotency_key)
);
create index wallet_ledger_user_created_idx on public.wallet_ledger(user_id,created_at desc);
create table public.missions (
 id text primary key, title text not null, description text not null,
 reward_coins bigint not null default 0 check(reward_coins>=0),
 reward_xp integer not null default 0 check(reward_xp>=0),
 is_active boolean not null default true, sort_order integer not null unique
);
create table public.player_missions (
 user_id uuid not null references auth.users(id) on delete cascade,
 mission_id text not null references public.missions(id),
 progress integer not null default 0 check(progress>=0),
 completed_at timestamptz, claimed_at timestamptz, primary key(user_id,mission_id)
);
create table public.pool_cycles (
 id uuid primary key default gen_random_uuid(),
 starts_at timestamptz not null, ends_at timestamptz not null,
 funded_amount numeric(18,8) not null default 0 check(funded_amount>=0),
 currency text not null default 'USD',
 status text not null default 'scheduled' check(status in ('scheduled','open','review','completed','cancelled')),
 source_reference text, created_at timestamptz not null default now(), check(ends_at>starts_at)
);
create table public.pool_points (
 cycle_id uuid not null references public.pool_cycles(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 points bigint not null default 0 check(points>=0), updated_at timestamptz not null default now(),
 primary key(cycle_id,user_id)
);
create table public.payout_requests (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 cycle_id uuid references public.pool_cycles(id),
 amount numeric(18,8) not null check(amount>0), currency text not null default 'USD',
 status text not null default 'pending' check(status in ('pending','review','processing','paid','rejected','failed')),
 provider_reference text, idempotency_key text not null unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.security_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete set null,
 event_type text not null, risk_level text not null default 'low' check(risk_level in ('low','medium','high','critical')),
 ip_hash text, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
insert into public.rocket_catalog(id,display_name,price_coins,duration_minutes,cargo_capacity,description,sort_order) values
('scout','Scout',0,30,10,'Стартовая ракета для первых коротких экспедиций.',1),
('miner','Miner',1500,120,50,'Добывающий корабль с увеличенным грузовым отсеком.',2),
('explorer','Explorer',4500,240,120,'Исследовательский корабль для дальних маршрутов.',3),
('titan','Titan',12000,480,300,'Тяжёлая ракета для крупных экспедиций.',4),
('galaxy','Galaxy',30000,720,600,'Флагман стартовой линейки Crypto Astra.',5)
on conflict(id) do update set display_name=excluded.display_name,price_coins=excluded.price_coins,duration_minutes=excluded.duration_minutes,cargo_capacity=excluded.cargo_capacity,description=excluded.description,sort_order=excluded.sort_order;
insert into public.resource_catalog(id,display_name,icon,sort_order) values
('iron_ore','Iron Ore','⛰️',1),('copper','Copper','🟠',2),('blue_crystal','Blue Crystal','💎',3),
('amethyst','Amethyst','🔮',4),('quantum_stone','Quantum Stone','🪨',5),('stellar_core','Stellar Core','🌟',6)
on conflict(id) do update set display_name=excluded.display_name,icon=excluded.icon,sort_order=excluded.sort_order;
insert into public.missions(id,title,description,reward_coins,reward_xp,sort_order) values
('first_expedition','Первая экспедиция','Завершить первую космическую экспедицию.',50,20,1),
('collect_resources','Сборщик ресурсов','Получить ресурсы в экспедициях.',100,30,2),
('fleet_builder','Развитие флота','Приобрести вторую ракету.',150,40,3)
on conflict(id) do update set title=excluded.title,description=excluded.description,reward_coins=excluded.reward_coins,reward_xp=excluded.reward_xp,sort_order=excluded.sort_order;
alter table public.profiles enable row level security;
alter table public.player_wallets enable row level security;
alter table public.rocket_catalog enable row level security;
alter table public.resource_catalog enable row level security;
alter table public.player_rockets enable row level security;
alter table public.player_inventory enable row level security;
alter table public.expeditions enable row level security;
alter table public.wallet_ledger enable row level security;
alter table public.missions enable row level security;
alter table public.player_missions enable row level security;
alter table public.pool_cycles enable row level security;
alter table public.pool_points enable row level security;
alter table public.payout_requests enable row level security;
alter table public.security_events enable row level security;
grant select on public.rocket_catalog,public.resource_catalog,public.missions to anon,authenticated;
grant select on public.profiles,public.player_wallets,public.player_rockets,public.player_inventory,public.expeditions,public.wallet_ledger,public.player_missions,public.pool_points,public.payout_requests to authenticated;
grant select on public.pool_cycles to anon,authenticated;
create policy "catalog rockets are readable" on public.rocket_catalog for select to anon,authenticated using(true);
create policy "catalog resources are readable" on public.resource_catalog for select to anon,authenticated using(true);
create policy "active missions are readable" on public.missions for select to anon,authenticated using(is_active=true);
create policy "players read own profile" on public.profiles for select to authenticated using((select auth.uid())=id);
create policy "players read own wallet" on public.player_wallets for select to authenticated using((select auth.uid())=user_id);
create policy "players read own rockets" on public.player_rockets for select to authenticated using((select auth.uid())=user_id);
create policy "players read own inventory" on public.player_inventory for select to authenticated using((select auth.uid())=user_id);
create policy "players read own expeditions" on public.expeditions for select to authenticated using((select auth.uid())=user_id);
create policy "players read own ledger" on public.wallet_ledger for select to authenticated using((select auth.uid())=user_id);
create policy "players read own mission progress" on public.player_missions for select to authenticated using((select auth.uid())=user_id);
create policy "players read own pool points" on public.pool_points for select to authenticated using((select auth.uid())=user_id);
create policy "players read own payout requests" on public.payout_requests for select to authenticated using((select auth.uid())=user_id);
create policy "visible pool cycles are readable" on public.pool_cycles for select to anon,authenticated using(status in ('open','completed'));
revoke insert,update,delete on public.profiles,public.player_wallets,public.player_rockets,public.player_inventory,public.expeditions,public.wallet_ledger,public.player_missions,public.pool_points,public.payout_requests,public.security_events from anon,authenticated;
