-- Order statuses gain an admin-pickable color, same opaque-string convention as `icon` —
-- the backend doesn't interpret the value, the frontend owns the curated palette of keys
-- (see ORDER_STATUS_COLOR_KEYS in order-status-colors.ts).

alter table order_statuses add column if not exists color text not null default 'slot-1';
