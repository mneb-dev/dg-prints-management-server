-- The Calculator page's "hot sizes" feature (order-history-derived quick-size suggestions) has
-- been removed in favor of relying solely on each category's admin-configured commonSizes.
-- Drops the RPC and the index added specifically to support its order_items scan.
drop function if exists hot_sizes(text[], int);
drop index if exists order_items_product_category_lower_idx;
