-- FRIEDD SNAKE — Phase 1 schema
-- Run this once in the Supabase SQL Editor (or via `supabase db push`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles
-- One row per auth user. Created automatically by the trigger below.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- No insert/update/delete policy on profiles: in particular, a user must not
-- be able to update their own row, or they could set is_admin = true.

-- Auto-create a profile row whenever a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- access_codes
-- One row per calendar month ('YYYY-MM'). code_hash is a bcrypt hash,
-- never the plaintext code. Server-side only: RLS is enabled with no
-- policies at all, so anon/authenticated clients get zero access — only
-- the service role (which bypasses RLS) can read or write this table.
-- ---------------------------------------------------------------------------
create table if not exists public.access_codes (
  month text primary key, -- format: 'YYYY-MM'
  code_hash text not null,
  created_at timestamptz not null default now()
);

alter table public.access_codes enable row level security;
-- Intentionally no policies here — see comment above.

-- ---------------------------------------------------------------------------
-- user_access
-- One row per (user, month) once a student has unlocked that month.
-- ---------------------------------------------------------------------------
create table if not exists public.user_access (
  user_id uuid not null references auth.users (id) on delete cascade,
  month text not null, -- format: 'YYYY-MM'
  unlocked_at timestamptz not null default now(),
  primary key (user_id, month)
);

alter table public.user_access enable row level security;

drop policy if exists "Users can view own access" on public.user_access;

create policy "Users can view own access"
  on public.user_access for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy: rows are only ever written by the
-- verifyAccessCode server action, which uses the service-role client and
-- so bypasses RLS entirely. Regular users can never write their own
-- unlock rows directly.

-- ---------------------------------------------------------------------------
-- Dev seed: access code for the current month (Asia/Singapore).
-- Plaintext is 'WELCOME2026' — this is ONLY for local development.
-- The admin should replace it with a real rotated code before students
-- get access: see README.md "Set the monthly access code".
-- ---------------------------------------------------------------------------
insert into public.access_codes (month, code_hash)
values (
  to_char(now() at time zone 'Asia/Singapore', 'YYYY-MM'),
  crypt('WELCOME2026', gen_salt('bf'))
)
on conflict (month) do nothing;

-- ---------------------------------------------------------------------------
-- Grants. Some Supabase projects do not apply default table privileges to
-- tables created via the SQL Editor, which leaves the API roles locked out
-- (PostgREST error 42501). Explicit grants make the migration self-contained.
-- RLS policies above still control which ROWS authenticated users can see.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, service_role;
grant select on public.profiles to authenticated;
grant select on public.user_access to authenticated;
grant all on public.profiles to service_role;
grant all on public.user_access to service_role;
grant all on public.access_codes to service_role;
alter default privileges in schema public grant all on tables to service_role;
