# KopaBook

A lightweight merchant operating system for Nigerian small businesses: sales, stock,
customer debts, expenses, and a live dashboard. Built by Lifeverse Technologies.

**Stack:** React + Vite frontend, Cloudflare Pages Functions API, Cloudflare D1 database.

## Quick start (local)

```bash
npm install
npm run dev          # frontend only
```

## Local full-stack test (frontend + API + D1)

```bash
npx wrangler pages dev dist --port 8788 --d1 KOPABOOK_DB=kopabook_db
# then apply the schema to the local D1 once:
npx wrangler d1 execute kopabook_db --local --file=migrations/0001_initial.sql
```

For owner setup locally, create `.dev.vars` with:

```
BOOTSTRAP_KEY=your-local-test-key
```

Then open http://localhost:8788/owner-setup.

## Deploy to Cloudflare Pages (production)

1. Create a D1 database: `npx wrangler d1 create kopabook_db`
2. Copy the `database_id` into `wrangler.toml`.
3. Apply migrations: `npx wrangler d1 execute kopabook_db --file=migrations/0001_initial.sql`
4. Create the Pages project `kopabook` connected to the `Lifeverse-Technologies/kopabook` repo.
5. In Pages settings:
   - D1 binding: `KOPABOOK_DB` → `kopabook_db`
   - Secret: `BOOTSTRAP_KEY` → a long random string (used once for owner setup)
6. Deploy. Then visit `/owner-setup` once to create the owner account and business.

## Project structure

```
src/                  React frontend (pages, components, styles)
  pages/              Marketing, Auth, Dashboard, Products, Sales,
                      Expenses, Customers, Debts, Reports, Staff, Settings
  components/         App shell layout
  lib/api.js          API client + helpers
functions/api/        Pages Functions (serverless API)
  auth/               bootstrap, login, me, logout
  products, sales, expenses, customers, debts, stock, dashboard,
  reports, staff, business, waitlist
migrations/           D1 schema
public/_redirects     SPA fallback for Cloudflare Pages
wrangler.toml         Pages + D1 binding config
```

## Key business rules

- Every sale deducts stock immediately and writes inventory movements.
- Unpaid sale balances auto-create customer debt with a running ledger.
- Debt payments reduce the ledger balance and are recorded as payments.
- Only owners/managers manage products and stock; only owners manage staff and settings.
- Sessions use secure httpOnly cookies (`kopabook_session`).

## Roadmap

1. ~~Live dashboard metrics~~ (done)
2. Receipts / exports (CSV)
3. Offline-first behaviour
4. Multi-branch support
