-- FRIEDD SNAKE — Security fixes (Phase 2, Part A)
-- Brute-force throttling on access-code attempts. Case-insensitive codes and
-- the admin gate bypass are application-layer changes and need no schema
-- change beyond this table.

-- ---------------------------------------------------------------------------
-- access_code_attempts
-- One row per user. Tracks consecutive failed access-code attempts for the
-- brute-force lockout. Server-side only (service role), same pattern as
-- access_codes: RLS enabled with zero policies so anon/authenticated clients
-- get no access at all.
-- ---------------------------------------------------------------------------
create table if not exists public.access_code_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  failed_count integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.access_code_attempts enable row level security;
-- Intentionally no policies here — service-role only, same as access_codes.

grant all on public.access_code_attempts to service_role;

notify pgrst, 'reload schema';
