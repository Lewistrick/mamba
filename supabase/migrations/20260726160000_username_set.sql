-- Locked account username flag (set once before first play).

alter table public.profiles
  add column if not exists username_set boolean not null default false;

-- Existing rows that already customized beyond the signup default keep needing a set.
-- New signups start with username_set = false until the client sets a name.
