-- Per-category order-status workflow. Previously hardcoded in the frontend as
-- CATEGORY_STATUS_FLOWS (order-status.ts), keyed by category name strings that
-- had drifted from the real category names (the map used "Sticker"/"Sintra"/
-- "3D Print", but the row names vary by environment — 20260903110000's seed
-- used "Sticker Label"/"Sintra Board"/"3D Print", and at least one environment
-- has since had those categories renamed via the app to "Sticker"/"Sintra"/
-- "3D" — see Manage Categories, which allows renaming). Any mismatch meant
-- that category silently fell back to the 3-step default. Now that categories
-- are admin-managed and new ones can be created at any time, the flow needs
-- to live alongside the category row instead of a static lookup that only
-- knows about the categories that existed at seed time. `cancelled`/
-- `refunded` are intentionally excluded — those stay universal, appended by
-- the frontend's getOrderStatusOptions regardless of category.

alter table categories
  add column if not exists status_flow text[] not null default '{pending,layout,released}';

alter table categories
  add constraint categories_status_flow_valid_statuses
  check (status_flow <@ array['pending','layout','trace','print','cut','pack','pickup','released']::text[]);

-- Backfill the flows that were previously hardcoded in the frontend map. Matched by
-- lower(name) against both the original seed name and the known renamed variant, since
-- which one is live depends on the environment (dev has already been renamed to the
-- shorter forms; other environments may still have the original seed names).
update categories set status_flow = '{pending,layout,trace,print,cut,pack,pickup,released}' where lower(name) in ('sticker label', 'sticker');
update categories set status_flow = '{pending,layout,trace,print,cut,pack,pickup,released}' where lower(name) = 'laminated sticker';
update categories set status_flow = '{pending,layout,print,pickup,released}' where lower(name) = 'tarpaulin';
update categories set status_flow = '{pending,layout,print,cut,pickup,released}' where lower(name) in ('sintra board', 'sintra');
update categories set status_flow = '{pending,layout,print,pickup,released}' where lower(name) in ('3d print', '3d');
update categories set status_flow = '{pending,layout,released}' where lower(name) = 'general merchandise';
