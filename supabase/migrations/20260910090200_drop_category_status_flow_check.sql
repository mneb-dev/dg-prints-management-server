-- categories.status_flow's check constraint hardcoded the fixed 8-status allow-list.
-- Statuses are now admin-managed (order_statuses table), so the allow-list is no longer
-- fixed at migration time — validation moves to the app layer (categories.ts's
-- validateStatusFlow, checked against active order_statuses.name).

alter table categories drop constraint if exists categories_status_flow_valid_statuses;
