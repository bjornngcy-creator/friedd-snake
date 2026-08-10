-- Manual alternative to `node scripts/set-access-code.mjs`.
-- Paste into the Supabase SQL Editor to set/rotate the code for a month.
-- Replace 'YOUR-NEW-CODE' and the month before running.

insert into public.access_codes (month, code_hash)
values (
  '2026-08', -- change to the target month, format 'YYYY-MM'
  crypt('YOUR-NEW-CODE', gen_salt('bf'))
)
on conflict (month) do update
  set code_hash = excluded.code_hash;
