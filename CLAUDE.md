# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project layout

This repo is the backend for the sibling `dg-prints-management-portal` repo (React/Vite frontend), which calls
it over HTTP at `VITE_API_BASE_URL` (default `http://localhost:3000/api`).

## Commands

- `npm install` — install dependencies
- `npm run dev` — run with `tsx watch` against `src/server.ts` (auto-restarts on change)
- `npm run build` — compile TypeScript to `dist/` (`tsc`)
- `npm start` — run the compiled server from `dist/server.js`

There is no lint or test runner configured yet.

### Environment

`src/config/env.ts` picks the env file to load based on `NODE_ENV` (set via `cross-env` in the npm scripts):
`.env.development` for `npm run dev`/`npm run seed:superadmin`, `.env.production` for `npm start`/
`npm run seed:superadmin:prod`. Both are gitignored. Copy `.env.example` to `.env.development` for local dev,
or `.env.production.example` to `.env.production` for a production deploy, and set:
- `PORT` (default `3000`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — required; `src/config/supabaseClient.ts` throws at startup if
  either is missing.
- `JWT_SECRET` — required; `src/config/env.ts` throws at startup if missing.
- `CRON_SECRET` — required in production; gates `GET /api/internal/process-recurring-expenses` (invoked daily by
  the Vercel Cron configured in `vercel.json`) via `Authorization: Bearer $CRON_SECRET`, since that route sits
  outside `requireAuth`/JWT.

## Architecture

- **Stack**: Express 4 + TypeScript, ESM (`"type": "module"`, `NodeNext` module resolution — internal imports
  must use `.js` extensions, e.g. `from '../data/productStore.js'`, even though the source files are `.ts`).
- **Entry split**: `src/server.ts` just calls `createApp()` (`src/app.ts`) and `app.listen`. `createApp` wires
  `helmet`, `cors`, `morgan('dev')`, `express.json()`, then mounts `/health`, `/api/test`, `/api/products`,
  followed by the shared `notFound`/`errorHandler` middleware (`src/middleware/errorHandler.ts`) — any new
  router must be mounted before those two.
- **Layout**: `src/routes/` (Express routers, thin — validate + call the data layer + `next(err)` on failure),
  `src/data/` (Supabase access, one "store" module per domain), `src/config/` (env loading, Supabase client),
  `src/types/` (shared domain types).

### Supabase access pattern

- `src/config/supabaseClient.ts` creates the Supabase client with the **service role key**, which bypasses
  Row Level Security. Migrations (`supabase/migrations/`) enable RLS on every table with **no policies**
  (default-deny for the anon/authenticated Data API) — this server is meant to be the only writer, fronted by
  its own auth later. Do not switch to the anon key without adding RLS policies first.
- Reads (`listProducts`, `getProduct`) and deletes go straight through `supabase.from(...)`. Creates and updates
  instead call the `upsert_product` Postgres RPC function (defined in
  `supabase/migrations/20260828193329_create_product_tables.sql`), which atomically syncs a product's row plus
  its `product_options` / `product_option_values` / `product_pricing` child rows from a single JSON payload —
  deleting child rows not present in the payload and upserting the rest by id. `productStore.ts`'s
  `toRpcPayload`/`mapRowToProduct` convert between the API's camelCase `Product` shape and the RPC's snake_case
  payload/row shape. Follow this same read-direct / write-via-RPC split for new nested-resource domains rather
  than issuing multiple dependent Supabase calls from route/store code.
- IDs for new products/options/pricing entries are generated client-side in `productStore.ts` via
  `randomUUID()` (`forceNewIds` in `normalizeOptions`/`normalizePricing`), not left to the DB default, so the
  RPC payload always has ids to upsert against.
