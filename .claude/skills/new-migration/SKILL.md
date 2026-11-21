---
name: new-migration
description: Use when a change needs a Supabase schema change (table, column, RLS policy, function such as send_route). Writes the next numbered migration with its matching database test, runs npm run test:db, and gives the user the SQL to run in Supabase.
---

# New Supabase migration

The schema lives only in `supabase/migrations/NNNN_<name>.sql`, applied in order. Each migration has a test file `tests/db/NNNN_<name>.test.sql` with the same name. `npm run test:db` builds a fresh Postgres per test file: Supabase stub (`tests/db/supabase-stub.sql`), every migration, `tests/db/helpers.sql`, then the test.

## 1. Write the migration

- Next number after the highest in `supabase/migrations/` (four digits).
- Never edit a migration that was already applied in Supabase. Change things in a new one.
- First lines: a comment saying what it does and `-- Run once in the Supabase SQL editor after NNNN.` (like 0002 and 0003).
- Safe to re-run where Postgres allows: `create or replace function`, `add column if not exists`.
- Every new table: `enable row level security` plus select policies scoped to the caller's company through `members`, like 0001. Couriers get no insert/update/delete policies; their writes go through functions. No table readable by `anon`.
- Functions that bypass RLS (`security definer`) set `search_path` and check membership and role themselves.

## 2. Write the test

Copy the header of the newest `tests/db/*.test.sql` (the `\set` lines, fixed UUIDs, `insert into companies` / `members`). Then:

- Act as a user: `set role authenticated; set request.jwt.claim.sub = :A;`
- One `select ok('<what must be true>', <boolean>);` per behavior. `t_error(sql)` returns `'NO ERROR'` or the error text; `t_rows(sql)` returns the row count of a query.
- Cover the negative path: a courier, another company's member, or `anon` must be refused or see nothing.

## 3. Run

```bash
npm run test:db
```

All files must pass, not only the new one (later migrations run on top of earlier ones). Then `npm test`, since app tests in `tests/company-*.test.ts` model the same RPCs.

## 4. Hand-off to the user

The user applies migrations by hand in the Supabase dashboard (SQL Editor). In the reply, give the migration file path and say in one line that it must run there before the app code that depends on it is deployed. Applying it to production is the user's step; do not claim it was applied.
