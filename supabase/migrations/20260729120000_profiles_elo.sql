-- Online 1v1 Elo rating (initial 1000; updated by the multiplayer server).

alter table public.profiles
  add column if not exists elo integer not null default 1000;

comment on column public.profiles.elo is
  'Online 1v1 Elo rating (initial 1000, K=32)';

-- Clients may update display_name / username_set, but not forge Elo.
create or replace function public.profiles_guard_elo()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.elo is distinct from old.elo
     and auth.role() is distinct from 'service_role' then
    new.elo := old.elo;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_elo on public.profiles;
create trigger profiles_guard_elo
  before update on public.profiles
  for each row execute function public.profiles_guard_elo();
