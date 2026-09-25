-- The original order_number default was
--   'ORD-' || lpad(nextval('orders_order_number_seq')::text, 3, '0')
-- but lpad() truncates strings longer than the target length, so once the
-- sequence passed 999 it produced ORD-100, ORD-100, ..., ORD-101 — all already
-- taken — and every create failed with
-- `duplicate key value violates unique constraint "orders_order_number_key"`.
--
-- next_order_number() pads to at least 3 digits without truncating, and skips
-- any number that's already present so an out-of-band insert (import, manual
-- row) can't block order creation either.

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
    v_candidate := 'ORD-' || lpad(v_n, greatest(3, length(v_n)), '0');
    exit when not exists (select 1 from orders where order_number = v_candidate);
  end loop;
  return v_candidate;
end;
$$;

alter table orders alter column order_number set default next_order_number();
