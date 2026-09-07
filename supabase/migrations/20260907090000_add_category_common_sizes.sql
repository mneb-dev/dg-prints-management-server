-- Admin-configured "quick sizes" for the Calculator page, per category. Lives on the
-- category row for the same reason status_flow does (see 20260905150000_add_category_status_flow.sql):
-- a frontend name-keyed map drifts out of sync whenever a category gets renamed via
-- Manage Categories, so category-scoped config belongs on the category row itself, not a
-- static lookup table in the frontend.
--
-- Only Sticker Label and Tarpaulin are configured independently — Laminated Sticker has no
-- row of its own here and always mirrors the Sticker Label row's common_sizes in the
-- frontend (see calculator-page.tsx). Every other category (Sintra, 3D, General
-- Merchandise, ...) simply leaves this column at its '[]' default, unused.
--
-- Each array element is a plain {width, height, unit} triple (no name/label field — the
-- Calculator page's quick-size chips render the formatted dimensions directly). Validation
-- of element shape (positive width/height, known unit, an entry-count cap) is intentionally
-- left to the Express route layer (see routes/categories.ts's validateCommonSizes) rather
-- than a deep CHECK constraint here — Postgres CHECK constraints can't cleanly iterate/
-- validate jsonb array elements without an extra marked-immutable helper function, which
-- isn't justified for what's ultimately admin-entered, already-validated-on-write data. This
-- mirrors the existing split where validateName's length cap is Express-only while
-- status_flow's simple value-domain check got a DB-level `<@` constraint.

alter table categories
  add column if not exists common_sizes jsonb not null default '[]'::jsonb;

alter table categories
  add constraint categories_common_sizes_is_array
  check (jsonb_typeof(common_sizes) = 'array');
