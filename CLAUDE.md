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
- **Product images** live in the public Supabase Storage bucket `product-images` (created by
  `20260926090000_create_product_images.sql`), recorded in `product_images` (lowest `sort_order` = main
  image). They are *not* part of the `upsert_product` payload — they're managed only via
  `src/routes/productImages.ts` (`/api/products/:id/images`, admin/superadmin only). Upload is
  direct-to-storage: `POST /upload-url` returns a signed URL, the portal PUTs the (browser-resized WebP)
  file straight to Storage — keeping files off Vercel's 4.5 MB request body limit — then `POST /` with the
  path registers it. Storage access goes through the `ImageStorage` adapter in `src/config/imageStorage.ts`.
  `PRODUCT_SELECT` embeds `product_images`, so that migration must be applied before deploying this code.
- **Online shop routes** (`src/routes/shop.ts`, public, no auth) force `show_in_shop` + not deleted themselves;
  Inactive products are still listed with `inStock: false` ("Out of stock" in the shop).
  Products also carry `made_to_order` (shop shows "Message us on Facebook" instead of "Add to cart"), and `GET /api/shop/settings` exposes only `app_settings.messenger_url`.
- **Shop checkout**: `GET /api/shop/shipping` returns the Luzon/Visayas/Mindanao fees
  (`app_settings.shipping_fee_luzon|visayas|mindanao`) and every province with its region
  (`src/utils/phProvinces.ts`, the only copy). `POST /api/shop/orders` (`src/routes/shopOrders.ts`, public,
  rate-limited per IP + honeypot) re-resolves every line's price from the DB (`src/utils/shopPricing.ts`),
  returns 409 `{ error, itemIndex }` when a line is no longer orderable or its price changed. A cart with a
  price-on-request (`Manual`) line becomes a pending/unpaid order right away (channel "Online shop", no
  `created_by`, address joined into one line) → `{ kind: 'order', orderNumber, total }`.
- **Shop payments (PayMongo Checkout Sessions)**: a fully-priced cart instead becomes a `shop_checkouts` row
  holding the frozen `upsert_order` payload (`buildOrder` + `toRpcPayload`) plus a PayMongo session →
  `{ kind: 'payment', checkoutId, checkoutUrl }`; the shop redirects there. **No order exists until payment
  is confirmed**: the `complete_shop_checkout` RPC (row-locked, idempotent) creates it as paid, called by
  both `POST /api/webhooks/paymongo` (`src/routes/paymongoWebhook.ts`, verified via `Paymongo-Signature`
  against the raw body that `express.json({ verify })` keeps as `req.rawBody`) and
  `GET /api/shop/checkouts/:id` (`src/routes/shopCheckouts.ts`, polled by the shop's `/checkout/return`
  page; asks PayMongo directly if the webhook hasn't landed). Staff get the same re-check through
  `/api/shop-checkouts` (`src/routes/shopCheckoutsAdmin.ts`, `manage_orders`): `GET ?search=` lists checkouts
  by buyer name or phone digits, `POST /:id/check` runs `recheckShopCheckout` — the portal's "Check payment"
  dialog on the Orders page, for "I was charged but got no order" claims. PayMongo client: `src/utils/paymongo.ts`
  (plain `fetch`, no SDK). Env: `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` (the `secret_key` returned
  when registering that environment's webhook), `PAYMONGO_PAYMENT_METHODS` (default `gcash`; add `paymaya` etc. once enabled), `SHOP_URL`. Migration
  `20261002090000_add_shop_checkouts.sql` must be applied before deploying this code. The PayMongo shipping
  row's thumbnail is `product-images/static/shipping.png` in each environment's Storage, uploaded by hand
  (not part of any migration) — upload it to prod too before go-live. **Convenience fee**:
  `app_settings.convenience_fee_percent` (0 = off, migration `20261003090000_add_convenience_fee.sql`) is baked
  into every price the shop API returns (`toShopProduct` → `withConvenienceFee`: nearest whole peso, halves up,
  never below the original). Checkout compares cart prices against those marked-up prices, saves order items at
  their original prices and stores the difference as `additional_fees` with a "Convenience fee 2.5%" note, so the
  order total equals what the buyer saw. Shipping and made-to-order products (Messenger-only) aren't marked up.
- IDs for new products/options/pricing entries are generated client-side in `productStore.ts` via
  `randomUUID()` (`forceNewIds` in `normalizeOptions`/`normalizePricing`), not left to the DB default, so the
  RPC payload always has ids to upsert against.
