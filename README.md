# SplitBill

A free, self-hosted Splitwise-style app for splitting expenses with friends. Installable on your phone (PWA).

**Stack:** Vite + React + TypeScript · Supabase (Postgres, auth, realtime) · Cloudflare Workers (hosting). All on free tiers.

## Features

- Email/password sign-up and sign-in
- Groups with invite link / invite code
- Expenses split equally, by exact amounts, percentages or shares
- Net balances and simplified "who owes who" payments
- Settle up (records a payment); payments can be reverted from the Balances tab
- Expense list styled like Splitwise for Android: grouped by month, each row shows the date, a coloured initial tile, "X paid …" and "you lent / you borrowed" (green / orange)
- Splitwise-style Groups home (overall balance, per-group "X owes you"), group header with overall balance and per-person lines plus a chip row (Settle up / Expenses / Balances / History), and an expense detail view (paid-by tree, added/updated info, activity) opened by tapping a row
- Filter expenses by payer or text; tap an expense row to edit it (delete is inside the edit view); a **History** tab shows a vertical timeline (grouped by day) of the audit log of who created, changed or deleted expenses and payments, with full details (amount, payer, who shared what, before → after for edits), and deleted expenses can be restored from there
- Add-expense date shows as `Mon-DD` (tap to open the calendar and override); an **Advanced** section lets you tick a category (🍽️ Food & Drinks, 🛒 Groceries, 🚕 Transport, ✈️ Flights, 🏨 Stay, 🎟️ Tickets & Activities, 🛍️ Shopping, ⛽ Petrol & Toll, 📦 Other), shown as the emoji on the expense tile.- **Billing** tab: summary tiles (total, per person, per day, count), spending by category (donut), paid vs. share per person, who spent on what (per-person stacked category bars), spending by day, by month (when the group spans several months), and biggest expenses
- Local vs settlement currency (both default to SGD): per expense, enter the amount in the trip's local currency (converted at a live FX rate, with an opt-in "Override rate" checkbox; rounded to 2 dp) or directly in the settlement currency
- **Receipt photos**: on an expense tap 📷 *Take photo* (opens the phone camera) or 🖼️ *Choose photo*, crop with draggable corners, and the app shrinks it (max 1400px), converts it to black & white with auto-contrast and re-encodes it as a ~100 KB JPEG in the browser before upload. Images live in a private Cloudflare R2 bucket; the expense stores only the `receipt_key`. Shown in the expense detail (tap to enlarge). Receipts of deleted expenses are kept so *Restore* still works
- Realtime updates across members' devices
- Installable PWA, works with light/dark mode

## Setup

1. **Supabase:** create a free project, open *SQL Editor*, and run the whole of `supabase/schema.sql`. The file is idempotent (fresh or existing database, never deletes data), so after every schema change just paste and run the whole file again.
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

### Receipt storage (Cloudflare R2, one-time)

1. Cloudflare dashboard → *R2 Object Storage* → enable R2 (free tier: 10 GB, 1M writes, 10M reads per month, no egress fees; Cloudflare asks for a payment method but won't charge within the free tier) → create a **private** bucket named `splitbill-receipts` (don't enable public access).
2. In `wrangler.jsonc` set `SUPABASE_URL` and `SUPABASE_ANON_KEY` under `vars` (public values, same as the `VITE_` ones). The Worker (`worker/index.ts`) uses them to check the caller is a member of the group before reading/writing a receipt.
3. Re-run `supabase/schema.sql` (adds `expenses.receipt_key`).
4. Push to `main`; the Worker and R2 binding deploy together with the site. `npm run dev` serves only the frontend, so uploads need the deployed Worker (or `npx wrangler dev` after `npm run build`).

Gotcha: `package-lock.json` must point at `registry.npmjs.org`. A lockfile generated through a
private npm mirror makes Cloudflare builds fail with `403`.

## Project layout

- `supabase/schema.sql`: tables, row-level security, invite/join function
- `src/lib/balances.ts`: balance, debt simplification and split math
- `src/lib/fx.ts`: live FX rate lookup (frankfurter.app, no key)
- `worker/index.ts`: Cloudflare Worker, receipt upload/download API over R2 (`/api/receipts/*`); everything else is static assets
- `src/lib/receipt.ts`, `src/components/Receipt*.tsx`: crop, B&W + shrink, upload, thumbnail
- `src/pages/`: Auth, Groups, GroupPage (expenses, balances, add expense), Join

## Notes

- The free Supabase tier pauses a project after 7 days of inactivity; resume it from the dashboard.
- Amounts are handled in cents to avoid rounding errors.
- Expense amounts and splits are always stored in the settlement currency; the original local amount and FX rate are kept on the expense.
- Schema changes go into `supabase/schema.sql` in place (keep every statement re-runnable: `if not exists`, `create or replace`, `drop ... if exists` before `create`).

## Status / TODO

- [x] Schema, auth, groups, expenses, balances, settle up, PWA
- [x] Run schema in Supabase
- [x] Deploy to Cloudflare
- [ ] Test with a friend on the live URL
- [x] Edit existing expenses, audit log (History tab)
- [x] Expense categories
- [ ] Per-expense comments
