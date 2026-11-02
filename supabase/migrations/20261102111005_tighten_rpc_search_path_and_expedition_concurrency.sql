
alter function private.handle_new_user() set search_path = '';
alter function public.purchase_rocket(text,text) set search_path = '';
alter function public.launch_expedition(uuid,text) set search_path = '';
alter function public.complete_expedition(uuid) set search_path = '';
create unique index if not exists expeditions_one_active_per_rocket
  on public.expeditions(player_rocket_id) where status='in_progress';
revoke insert,update,delete on public.rocket_catalog,public.resource_catalog,public.missions,public.pool_cycles from anon,authenticated;
