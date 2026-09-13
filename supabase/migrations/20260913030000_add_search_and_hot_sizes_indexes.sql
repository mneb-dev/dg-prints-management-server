-- hot_sizes() filters order_items by lower(product_category) with no supporting index, forcing
-- a full sequential scan of order_items -- the fastest-growing table in this schema -- on every
-- Calculator-page load.
create index if not exists order_items_product_category_lower_idx
  on order_items (lower(product_category));

-- list_orders()/list_expenses() search with leading-wildcard ilike ('%term%'), which a plain
-- btree index can never use, forcing a full scan of orders/order_items/expenses on every search
-- keystroke. pg_trgm + a GIN trigram index lets ilike '%term%' use an index scan instead.
create extension if not exists pg_trgm;

create index if not exists orders_order_number_trgm_idx on orders using gin (order_number gin_trgm_ops);
create index if not exists orders_customer_name_trgm_idx on orders using gin (customer_name gin_trgm_ops);
create index if not exists orders_notes_trgm_idx on orders using gin (notes gin_trgm_ops);
create index if not exists order_items_notes_trgm_idx on order_items using gin (notes gin_trgm_ops);

create index if not exists expenses_notes_trgm_idx on expenses using gin (notes gin_trgm_ops);
create index if not exists expenses_category_trgm_idx on expenses using gin (category gin_trgm_ops);
