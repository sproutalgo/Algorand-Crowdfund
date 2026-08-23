/**
 * migrate.js
 * Run once to set up the Supabase schema:
 *   node src/utils/migrate.js
 *
 * You can also paste the SQL directly into the Supabase SQL editor.
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SQL = `
-- ─────────────────────────────────────────────────────────────────────────────
-- projects — one row per deployed crowdfunding contract
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists projects (
  app_id          bigint primary key,          -- Algorand application ID
  creator_address text   not null,             -- on-chain creator wallet

  -- human-readable metadata (stored off-chain here)
  name            text   not null,
  tagline         text   not null default '',
  description     text   not null default '',
  category        text   not null default 'Other',
  website_url     text   not null default '',
  deck_url        text   not null default '',
  image_url       text   not null default '',
  token_name      text   not null default '',

  -- economics (captured at deployment so they survive contract deletion)
  goal_micro      bigint not null default 0,   -- funding goal in microALGO
  rate_per_algo   bigint not null default 0,   -- tokens_per_bundle (whole tokens)
  algo_per_bundle bigint not null default 1,   -- algo_per_bundle (whole ALGO, >0)

  -- lifecycle flags (written explicitly at known moments)
  is_funded       boolean not null default false,
  is_distributed  boolean not null default false,
  is_refunded     boolean not null default false,
  is_cancelled    boolean not null default false,
  is_hidden       boolean not null default false,  -- admin hide from Explore

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- auto-update updated_at on every row change
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at
  before update on projects
  for each row execute procedure touch_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotent column additions (for databases created before a column existed).
-- Safe to run repeatedly; no-op if the column already exists.
-- ─────────────────────────────────────────────────────────────────────────────
alter table projects add column if not exists algo_per_bundle bigint not null default 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- Campaign metadata + series/milestone columns. The insert path in
-- services/projects.js writes all of these; keep this list in sync so a fresh
-- database has every column the code expects. milestone_completed_at is the one
-- whose absence 500s the series query (silently swallowed by the frontend),
-- hiding the entire series timeline.
-- ─────────────────────────────────────────────────────────────────────────────
alter table projects add column if not exists is_donation             boolean not null default false;
alter table projects add column if not exists highlights              jsonb;
alter table projects add column if not exists series_id               text;
alter table projects add column if not exists series_goal_micro       int8;
alter table projects add column if not exists milestone_number        int8;
alter table projects add column if not exists milestone_title         text;
alter table projects add column if not exists milestone_description   text;
alter table projects add column if not exists planned_milestones      jsonb;
alter table projects add column if not exists milestone_completed_at  timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security
-- Public can read projects that aren't hidden.
-- Only the service role (our backend) can write.
-- ─────────────────────────────────────────────────────────────────────────────
alter table projects enable row level security;

-- anyone can read non-hidden projects
drop policy if exists "public read" on projects;
create policy "public read"
  on projects for select
  using (true);   -- frontend filters is_hidden itself via the API

-- only service role can insert/update/delete (API uses service role key)
-- no additional policy needed — service role bypasses RLS
`

async function migrate() {
  console.log('Running migration…')
  const { error } = await supabase.rpc('exec_sql', { sql: SQL }).catch(() => ({ error: null }))

  // Supabase doesn't expose a raw SQL RPC by default — use the REST approach
  // Instead, print the SQL and instruct the developer to run it in the dashboard
  console.log('\n─────────────────────────────────────────────────────────────')
  console.log('Paste the following SQL into your Supabase SQL editor:')
  console.log('https://app.supabase.com → your project → SQL Editor')
  console.log('─────────────────────────────────────────────────────────────\n')
  console.log(SQL)
  console.log('\n─────────────────────────────────────────────────────────────')
  console.log('Migration SQL printed above. Run it in Supabase SQL Editor.')
}

migrate()
