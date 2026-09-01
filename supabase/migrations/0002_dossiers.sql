-- The Tribunal — uploaded case dossiers
--
-- ADDITIVE upgrade for a database that already has 0001 applied. It creates no
-- conflicts and destroys nothing, so it is safe to run on a live database with
-- runs already stored.
--
-- A brand-new database does not need this file: 0001_init.sql already contains
-- everything below.

-- 'dossier' joins the existing cast modes.
alter type character_mode add value if not exists 'dossier';

-- An uploaded case dossier: the extracted charge sheet and cast. Kept as its own
-- row so the character bodies never travel through the browser, and so one upload
-- can drive several runs (e.g. the same cast in uniform and per-character mode).
create table if not exists dossiers (
  id           uuid primary key default gen_random_uuid(),
  filename     text,
  page_count   int,
  char_count   int,
  charge_sheet text,
  characters   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

alter table runs
  add column if not exists dossier_id uuid references dossiers(id) on delete set null;

-- Each advocate now records how it built its case, the counterpart to a judge's
-- protocol, so all seven seats explain themselves.
alter table speeches
  add column if not exists reasoning text;

alter table dossiers enable row level security;
revoke all on dossiers from anon, authenticated;

notify pgrst, 'reload schema';
