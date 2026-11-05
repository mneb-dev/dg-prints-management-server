-- Backfill the "arranged" shipment flag added by 20261106090000_add_order_arranged.sql: every
-- released or refunded order with a shipping address had its shipment booked before the flag
-- existed, so mark them arranged. arranged_at is set to the migration time (the real booking
-- dates were never recorded). Orders already marked are left alone, so re-running is a no-op.
--
-- Apply right after 20261106090000_add_order_arranged.sql.

update orders
set arranged_at = now()
where arranged_at is null
  and status in ('released', 'refunded')
  and shipping_address is not null
  and jsonb_typeof(shipping_address) = 'object'
  and coalesce(trim(shipping_address->>'address'), '') <> '';
