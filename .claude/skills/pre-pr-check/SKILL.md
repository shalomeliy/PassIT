---
name: pre-pr-check
description: Run before opening or updating a PassIT pull request. Runs unit tests, typecheck and build, and the database checks when migrations changed, then reports one PASS or FAIL line per check.
---

# Pre-PR check

Run every check that applies to the diff, in this order. Stop at the first failure, fix it, then re-run only what failed.

## 1. What changed

```bash
git fetch origin main
git diff --name-only origin/main...HEAD
```

## 2. Checks

| Check | Command | Run when |
|---|---|---|
| Unit tests (Vitest) | `npm test` | always |
| Typecheck + production build (PWA, service worker) | `npm run build` | always (`tsc -b` runs first, so this is also the typecheck) |
| Database checks | `npm run test:db` | anything under `supabase/migrations/` or `tests/db/` changed |
| Parser cases | `npx vitest run tests/parser.test.ts` | `src/domain/parser.js`, `cities.js` or `tests/test-cases.js` changed (already part of `npm test`; run alone while fixing) |

`npm run test:db` needs Postgres 15+ binaries (`/usr/lib/postgresql/*/bin`, or set `PG_BIN`). It starts a throwaway server, so it is safe to run anywhere. If the binaries are missing, say so; do not skip it silently.

## 3. Hygiene

- No keys in the diff: `git diff origin/main...HEAD | grep -nE 'AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|eyJhbGciOi'` must print nothing. `.env.local` and `google-key.txt` are gitignored; keep it that way.
- A new env var? Run the `vercel-env-check` skill.
- A new migration? It needs a matching `tests/db/<same-name>.test.sql` (see `new-migration`).
- `dist/` is not committed.

## 4. Report

One line per check, with the real numbers from the output, for example:

```
npm test         PASS  168 tests, 21 files
npm run build    PASS
npm run test:db  PASS  139 of 139
secrets grep     PASS  nothing found
```

Put the same lines in the PR body under a "Checks" heading. Never write PASS for a check that did not run; write `SKIPPED (reason)`.
