-- Online shop checkout.
--
-- Regional shipping fees, picked by the buyer's province (see src/utils/phProvinces.ts).
-- They're separate from app_settings.shipping_fee, which stays the portal order form's default.
alter table app_settings
  add column if not exists shipping_fee_luzon numeric not null default 80,
  add column if not exists shipping_fee_visayas numeric not null default 120,
  add column if not exists shipping_fee_mindanao numeric not null default 150;

-- Shop orders are created with channel 'Online shop'; list it so staff can filter by it.
insert into order_channels (name, sort_order)
select 'Online shop', coalesce(max(sort_order), -1) + 1 from order_channels
where not exists (select 1 from order_channels where lower(name) = 'online shop');
