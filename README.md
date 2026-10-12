# SplitBill

A free, self-hosted Splitwise-style app for splitting expenses with friends. Installable on your phone (PWA).

**Stack:** Vite + React + TypeScript · Supabase (Postgres, auth, realtime) · Cloudflare Workers (hosting). All on free tiers.

## Features

- Email/password sign-up and sign-in
- Groups with invite link / invite code
- Expenses split equally, by exact amounts, percentages or shares
- Net balances and simplified "who owes who" payments
- Settle up (records a payment)
- Realtime updates across members' devices
- Installable PWA, works with light/dark mode

## Setup

1. **Supabase:** create a free project, open *SQL Editor*, and run `supabase/schema.sql`.
   In *Authentication → Providers → Email*, turn off "Confirm email" if you want instant sign-in.
2. Copy `.env.example` to `.env` and fill in your *Project URL* and *anon public key*
   (Project Settings → API). Never use the `service_role` key here.
3. Install and run:

   ```bash
   npm install
   npm run dev
   ```

## Deploy (Cloudflare Workers)

Live at https://splitbill.jack0726.workers.dev (auto-deploys on every push to `main`).

1. Push this repo to GitHub.
2. Cloudflare dashboard → *Workers & Pages → Create → Import a repository*, pick the repo.
3. Build command `npm run build`, deploy command `npx wrangler deploy` (config in `wrangler.jsonc`).
4. Under *Build variables* add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. In Supabase *Authentication → URL Configuration*, set the Site URL to the live URL above.

Gotcha: `package-lock.json` must point at `registry.npmjs.org`. A lockfile generated through a
private npm mirror makes Cloudflare builds fail with `403`.

## Project layout

- `supabase/schema.sql`: tables, row-level security, invite/join function
- `src/lib/balances.ts`: balance, debt simplification and split math
- `src/pages/`: Auth, Groups, GroupPage (expenses, balances, add expense), Join

## Notes

- The free Supabase tier pauses a project after 7 days of inactivity; resume it from the dashboard.
- Amounts are handled in cents to avoid rounding errors.

## Status / TODO

- [x] Schema, auth, groups, expenses, balances, settle up, PWA
- [x] Run schema in Supabase
- [x] Deploy to Cloudflare
- [ ] Test with a friend on the live URL
- [ ] Edit existing expenses, per-expense comments, expense categories
