-- top_customers()'s `latest` CTE (see 20260912100000_fix_top_customers_latest_contact.sql) scans
-- ALL of orders -- unlike the revenue-ranking part, deliberately unbounded by date so a
-- customer's contact info always comes from their true most recent order, not just one within
-- the ranking window. Confirmed via EXPLAIN ANALYZE that this does a full Seq Scan + Sort to
-- satisfy `distinct on (customer_key) order by customer_key, created_at desc`. This index
-- matches that access pattern exactly, letting Postgres use an index scan instead -- no change
-- to the function itself needed.
create index if not exists orders_customer_key_created_at_idx
  on orders (lower(trim(customer_name)), created_at desc);
