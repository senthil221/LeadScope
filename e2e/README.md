# Playwright E2E

Run against a real dev server (`npm run dev` auto-starts via `webServer` in
`playwright.config.ts`) and whatever Supabase project `.env.local` points at.
There is currently no disposable/local Supabase auth stack wired up for E2E —
`.env.local`'s `NEXT_PUBLIC_SUPABASE_URL` targets a hosted project, so these
tests should not create or mutate real records.

```bash
npx playwright test        # headless
npx playwright test --ui   # interactive
```

## Current coverage

`login.spec.ts` — unauthenticated only: sign-in page renders, invalid
credentials don't reach the workspace, sign-in/create-account toggle works.

## TODO: authenticated flows

The three flows worth covering once a test account exists:

1. Create a client, create a role under it, see it in the roles list.
2. Import a candidate (CSV or manual), see it land in "All Profiles".
3. Rate a candidate past the role's threshold, confirm it auto-advances to
   "Recruiter Shortlisted".

These need an approved operator account. Options, in order of preference:

- A dedicated test operator (email/password) approved in whatever table
  gates access (see `AppError` 403 path in `src/app/[[...path]]/page.tsx`),
  read from `E2E_EMAIL` / `E2E_PASSWORD` env vars — never hardcoded.
- A `beforeAll` that creates a scoped test operator via the Supabase admin
  API using `SUPABASE_SECRET_KEY`, and tears it down in `afterAll`.

Either way, authenticated specs should create their own client/role fixtures
and delete them in `afterAll`/`afterEach` rather than relying on or mutating
existing data.
