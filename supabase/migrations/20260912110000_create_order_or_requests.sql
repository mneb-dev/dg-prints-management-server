-- One-to-one, optional Official Receipt (OR) request details attached to an order.

create table if not exists order_or_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders (id) on delete cascade,
  name text not null,
  address text not null,
  tin text,
  invoice_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table order_or_requests enable row level security;

-- No policies: default-deny for anon/authenticated via the Data API.
-- The Express server uses the service_role key, which bypasses RLS.

drop trigger if exists order_or_requests_set_updated_at on order_or_requests;
create trigger order_or_requests_set_updated_at
  before update on order_or_requests
  for each row
  execute function set_updated_at();
