-- Performance: finance_summary(), commission_summary(), top_customers(), and order_stats() all
-- filter/aggregate `orders` by created_at/payment_status/status with no supporting index, forcing
-- full sequential scans that grow with order history -- this is what caused the "Gateway Timeout"
-- surfaced as a 500 from GET /api/finance/summary in production. Also adds the 10 unindexed
-- foreign keys flagged by Supabase's performance advisor (lint 0001_unindexed_foreign_keys).

-- Baseline: every date-range report query (finance_summary, commission_summary, top_customers)
-- filters on orders.created_at before narrowing further.
create index if not exists orders_created_at_idx on orders (created_at);

-- Targets the exact "collected revenue" predicate shared by finance_summary's revenue_orders CTE
-- and top_customers' windowed CTE, so those can index-scan instead of sequential-scan.
create index if not exists orders_paid_revenue_idx
  on orders (created_at)
  where payment_status = 'paid' and status not in ('cancelled', 'refunded', 'returned');

-- Unindexed foreign keys (Supabase performance advisor) -- speeds up joins, FK on-delete
-- set-null checks, and list_orders' p_created_by filter.
create index if not exists orders_created_by_idx on orders (created_by);
create index if not exists orders_status_updated_by_idx on orders (status_updated_by);
create index if not exists orders_commission_released_by_idx on orders (commission_released_by);
create index if not exists orders_commission_expense_id_idx on orders (commission_expense_id);
create index if not exists expenses_recurring_expense_id_idx on expenses (recurring_expense_id);
create index if not exists expenses_monthly_incentive_release_id_idx on expenses (monthly_incentive_release_id);
create index if not exists monthly_incentive_release_shares_user_id_idx on monthly_incentive_release_shares (user_id);
create index if not exists monthly_incentive_release_shares_expense_id_idx on monthly_incentive_release_shares (expense_id);
create index if not exists monthly_incentive_releases_released_by_idx on monthly_incentive_releases (released_by);
create index if not exists recurring_expenses_created_by_idx on recurring_expenses (created_by);
