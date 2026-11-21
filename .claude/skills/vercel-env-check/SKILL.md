---
name: vercel-env-check
description: Use when adding, renaming or debugging an environment variable, or when a Vercel deploy or preview behaves differently from local (blank map, "no key", 500 from /api). Lists every variable the code reads and checks it against .env.example, docs/SETUP.md and Vercel.
---

# Vercel env-var check

PassIT reads env vars in two places, and they behave differently on Vercel:

| Kind | Read with | When the value is fixed | After changing it in Vercel |
|---|---|---|---|
| Browser (`VITE_*`) | `import.meta.env.VITE_X` in `src/` | at **build** time, baked into the bundle | **Redeploy** is required |
| Server (`api/*.ts`) | `process.env.X` | at request time | applies to the next request |

`VITE_*` values are public: anyone can read them in the bundle. Never put a server secret in a `VITE_` variable.

## 1. List what the code reads

```bash
grep -rhoE "import\.meta\.env\.[A-Z_]+" src | sort -u
grep -rhoE "process\.env\.[A-Z_]+" api vite.config.ts | sort -u
```

`VITE_BUILD` is set by `vite.config.ts` from `VERCEL_GIT_COMMIT_SHA` and is not configured by hand.

## 2. Compare with the docs

Every variable from step 1 (except `VITE_BUILD` and `VERCEL_*`) must appear in:

- `.env.example`, with a one-line comment saying where the value comes from;
- the Environment Variables table in `docs/SETUP.md` section 7, if Vercel needs it.

Report each missing entry, and fix it in the same PR when the PR adds the variable.

## 3. Vercel checklist (the user does these; give exact names)

- The variable exists in Vercel > Project > Settings > Environment Variables, for **Production** and, if the feature is tested on a branch preview, **Preview** too.
- After a `VITE_*` change: Deployments > three dots > Redeploy.
- Google browser key: preview URLs are not in its website restriction, so maps and geocoding fail on previews by design (`docs/SETUP.md` section 7). Do not "fix" this by loosening the key.
- Paid APIs: remind the user to set a usage cap before adding the key.

## 4. Local

`set-google-key.bat` writes `.env.local` with `VITE_GOOGLE_MAPS_KEY` and `GOOGLE_ROUTES_KEY`. Other variables are added to `.env.local` by hand. `deploy-vercel.bat` passes only those two to Vercel.
