-- Mamba Phase 4: run this once in Supabase Dashboard → SQL Editor → New query → Run

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'AAA',
  username_set boolean not null default false,
  elo integer not null default 1000,
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists username_set boolean not null default false;

alter table public.profiles
  add column if not exists elo integer not null default 1000;

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  score integer not null,
  level integer not null check (level >= 1),
  size_id text not null check (size_id in ('small', 'medium', 'large')),
  mode text not null default 'solo',
  seed bigint not null,
  headings jsonb not null,
  verified boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists scores_board_idx
  on public.scores (size_id, mode, score desc, created_at asc);

create index if not exists scores_created_idx
  on public.scores (created_at desc);

create index if not exists scores_user_created_idx
  on public.scores (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.scores enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
  on public.profiles for select
  using (true);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Verified scores are publicly readable" on public.scores;
create policy "Verified scores are publicly readable"
  on public.scores for select
  using (verified = true);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, username_set, elo)
  values (new.id, 'AAA', false, 1000)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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

-- Backfill a profile row for users who signed up before the trigger existed.
insert into public.profiles (id, display_name, username_set, elo)
select id, 'AAA', false, 1000
from auth.users
on conflict (id) do nothing;

-- Guest play: scores can belong to a guest (no account) instead of a user.
alter table public.scores alter column user_id drop not null;

alter table public.scores
  add column if not exists guest_id uuid;

alter table public.scores
  drop constraint if exists scores_actor_present;
alter table public.scores
  add constraint scores_actor_present
  check (user_id is not null or guest_id is not null);

create index if not exists scores_guest_created_idx
  on public.scores (guest_id, created_at desc)
  where guest_id is not null;
