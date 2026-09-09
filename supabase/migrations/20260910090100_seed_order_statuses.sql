-- Backfill the 11 statuses that were previously hardcoded as ORDER_STATUSES in the
-- frontend's orders-slice.ts, in their current display order. `icon` values are the
-- kebab-case lucide-react icon names matching each status's current STATUS_ICONS entry
-- (order-status-badge.tsx) — the frontend's icon picker curates keys in this same format.

insert into order_statuses (name, label, icon, protected, sort_order) values
  ('pending', 'Pending', 'clock', true, 0),
  ('layout', 'To Layout', 'pencil-ruler', false, 1),
  ('trace', 'To Trace', 'pen-tool', false, 2),
  ('print', 'To Print', 'printer', false, 3),
  ('cut', 'To Cut', 'scissors', false, 4),
  ('pack', 'To Pack', 'package', false, 5),
  ('pickup', 'To Pick-up', 'truck', false, 6),
  ('released', 'Released', 'check-circle-2', true, 7),
  ('cancelled', 'Cancelled', 'x-circle', true, 8),
  ('refunded', 'Refunded', 'rotate-ccw', true, 9),
  ('returned', 'Returned', 'undo-2', true, 10)
on conflict (lower(name)) do nothing;
