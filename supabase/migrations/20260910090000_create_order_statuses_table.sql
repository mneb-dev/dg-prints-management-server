-- Order statuses become an admin-managed, reorderable, icon-tagged table instead of a
-- hardcoded literal list in the frontend. `name` is the literal value stored on
-- `orders.status` and inside `categories.status_flow` — this codebase consistently
-- references these small admin lists by name, not id (see categories itself).
-- `protected` marks the 5 built-in statuses (pending/released/cancelled/refunded/returned)
-- whose exact name is depended on elsewhere (mandatory category-flow membership, dedicated
-- Cancel/Refund/Return confirmation dialogs) — protected rows can't be renamed or deleted,
-- but can still be reordered, re-iconed, or disabled. `icon` is an opaque string key the
-- backend doesn't interpret, same convention as `users.avatar`.

create table if not exists order_statuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  label text not null,
  icon text not null default 'circle',
  protected boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists order_statuses_name_key on order_statuses (lower(name));

alter table order_statuses enable row level security;

drop trigger if exists order_statuses_set_updated_at on order_statuses;
create trigger order_statuses_set_updated_at
  before update on order_statuses
  for each row
  execute function set_updated_at();
