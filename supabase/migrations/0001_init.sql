-- The Tribunal — schema
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query),
-- or via `supabase db push` if you have the CLI linked to the project.
--
-- SAFE TO RE-RUN. The script drops the tribunal's own objects before recreating
-- them, so a half-applied or out-of-date schema can be repaired by running it
-- again. It touches nothing outside the five tables and five types below.
--
-- WARNING: re-running DELETES all stored runs, speeches, verdicts, and the cost
-- ledger. That is the intended trade-off for a demo app with no data worth
-- keeping — do not run this against a database whose history you want.

-- ------------------------------------------------------------ clean slate
-- Order matters only for readability; `cascade` handles the dependencies.

drop trigger  if exists llm_calls_bump_totals on llm_calls;
drop function if exists bump_run_totals() cascade;

drop table if exists llm_calls    cascade;
drop table if exists verdicts     cascade;
drop table if exists speeches     cascade;
drop table if exists participants cascade;
drop table if exists runs         cascade;
drop table if exists dossiers     cascade;

drop type if exists run_status     cascade;
drop type if exists model_mode     cascade;
drop type if exists character_mode cascade;
drop type if exists seat_role      cascade;
drop type if exists verdict_kind   cascade;

-- ---------------------------------------------------------------- enums

create type run_status   as enum ('queued','forging_cast','advocates_running',
                                  'judges_running','complete','failed','budget_exceeded');
create type model_mode   as enum ('uniform','per_character');
create type character_mode as enum ('default','named','auto','dossier');
create type seat_role    as enum ('advocate_for','advocate_against','judge');
create type verdict_kind as enum ('guilty','not_guilty','hung');

-- ---------------------------------------------------------------- tables

-- An uploaded case dossier: the extracted charge sheet and cast. Kept as its own
-- row so the character bodies never travel through the browser, and so one upload
-- can drive several runs (e.g. the same cast in uniform and per-character mode).
create table dossiers (
  id           uuid primary key default gen_random_uuid(),
  filename     text,
  page_count   int,
  char_count   int,
  charge_sheet text,
  characters   jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

create table runs (
  id                      uuid primary key default gen_random_uuid(),
  charge_sheet            text not null check (char_length(charge_sheet) between 20 and 4000),
  model_mode              model_mode not null,
  uniform_model_id        text,
  character_mode          character_mode not null default 'default',
  dossier_id              uuid references dossiers(id) on delete set null,
  status                  run_status not null default 'queued',
  error                   text,
  total_prompt_tokens     int not null default 0,
  total_completion_tokens int not null default 0,
  total_cost_usd          numeric(10,6) not null default 0,
  total_latency_ms        int not null default 0,
  created_at              timestamptz not null default now(),
  completed_at            timestamptz,
  -- uniform runs name their model; per-character runs read it off participants
  constraint uniform_model_present check (
    model_mode <> 'uniform' or uniform_model_id is not null
  )
);

create table participants (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references runs(id) on delete cascade,
  role         seat_role not null,
  seat_index   int not null,
  persona_key  text not null,
  persona_name text not null,
  -- The character description actually used for this seat, stored so a run stays
  -- reproducible after the defaults in code change. The fiction frame, advocate
  -- task, and injection guard are appended server-side and deliberately NOT stored.
  persona_body  text,
  persona_blurb text,
  model_id     text not null,
  unique (run_id, role, seat_index)
);

create table speeches (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references runs(id) on delete cascade,
  participant_id uuid not null unique references participants(id) on delete cascade,
  argument       text not null,
  key_points     jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);

create table verdicts (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references runs(id) on delete cascade,
  participant_id  uuid not null unique references participants(id) on delete cascade,
  verdict         verdict_kind not null,
  confidence      numeric(3,2) check (confidence between 0 and 1),
  reasoning       text not null,
  points_credited jsonb not null default '[]'::jsonb,
  points_rejected jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

-- every attempt, including failures and retries — this is the cost ledger
create table llm_calls (
  id                uuid primary key default gen_random_uuid(),
  run_id            uuid not null references runs(id) on delete cascade,
  participant_id    uuid references participants(id) on delete cascade,
  phase             text not null,
  model_id          text not null,
  attempt           int not null default 1,
  generation_id     text,
  prompt_tokens     int,
  completion_tokens int,
  cost_usd          numeric(10,6) not null default 0,
  latency_ms        int,
  http_status       int,
  error             text,
  created_at        timestamptz not null default now()
);

create index participants_run_idx on participants (run_id);
create index speeches_run_idx     on speeches (run_id);
create index verdicts_run_idx     on verdicts (run_id);
create index llm_calls_run_idx    on llm_calls (run_id, created_at);
create index runs_created_idx     on runs (created_at desc);

-- ------------------------------------------------- run totals via trigger
-- Keeps the budget guard to a single-row read instead of re-aggregating the
-- ledger on every check.

create or replace function bump_run_totals() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update runs set
    total_prompt_tokens     = total_prompt_tokens     + coalesce(new.prompt_tokens, 0),
    total_completion_tokens = total_completion_tokens + coalesce(new.completion_tokens, 0),
    total_cost_usd          = total_cost_usd          + coalesce(new.cost_usd, 0),
    total_latency_ms        = total_latency_ms        + coalesce(new.latency_ms, 0)
  where id = new.run_id;
  return new;
end;
$$;

create trigger llm_calls_bump_totals
  after insert on llm_calls
  for each row execute function bump_run_totals();

-- ------------------------------------------------------------------- RLS
-- Enabled with NO permissive policies: anon and authenticated get nothing.
-- The service-role key used by the route handlers bypasses RLS, so all access
-- goes through the server. This is the spec's "nothing secret lives in the
-- browser" rule enforced at the database rather than by convention.

alter table dossiers     enable row level security;
alter table runs         enable row level security;
alter table participants enable row level security;
alter table speeches     enable row level security;
alter table verdicts     enable row level security;
alter table llm_calls    enable row level security;

revoke all on dossiers, runs, participants, speeches, verdicts, llm_calls from anon, authenticated;

-- ------------------------------------------------------- refresh the API
-- PostgREST serves the REST API from a cached copy of the schema. Supabase
-- normally reloads it automatically, but it can lag — and a stale cache is
-- exactly what produces "Could not find the 'x' column of 'y' in the schema
-- cache" when the column plainly exists. This makes the reload explicit.

notify pgrst, 'reload schema';
