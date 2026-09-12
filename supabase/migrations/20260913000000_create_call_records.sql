-- Documents the call_records table as it already exists in the live Supabase
-- project (created directly via the Supabase dashboard, not via a prior
-- migration). This file exists so the schema is discoverable in the repo,
-- not just in Dan's dashboard — no defaults are asserted beyond what was
-- confirmed against the live table.

create table if not exists call_records (
  id uuid primary key,
  member_id text not null,
  member_name text,
  conversation_id text,
  status text not null,
  transcript text,
  outcome text,
  reason_for_leaving text,
  created_at timestamptz
);
