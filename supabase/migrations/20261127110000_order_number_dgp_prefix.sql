-- New orders are numbered DGP-01235, DGP-01236, ... instead of ORD-1235.
-- Same orders_order_number_seq counter, so numbering continues where ORD-
-- left off; existing ORD- numbers are kept as-is (SPX parcels, receipts and
-- customer messages reference them). Padding is at least 5 digits and never
-- truncates (see 20260925090000). list_orders sorts by the trailing digits,
-- so ORD- and DGP- orders still sort together numerically.

create or replace function next_order_number()
returns text
language plpgsql
volatile
as $$
declare
  v_n text;
  v_candidate text;
begin
  loop
    v_n := nextval('orders_order_number_seq')::text;
    v_candidate := 'DGP-' || lpad(v_n, greatest(5, length(v_n)), '0');
    exit when not exists (select 1 from orders where order_number = v_candidate);
  end loop;
  return v_candidate;
end;
$$;
