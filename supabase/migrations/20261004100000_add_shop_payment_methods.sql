-- The online payment options the shop's checkout lists (PayMongo payment method types, in display
-- order; the first is preselected). Managed in portal Settings -> Online shop. Separate from the
-- payment_methods catalog, which is what staff pick when recording payments on orders.
alter table app_settings
  add column if not exists shop_payment_methods text[] not null default '{gcash}';
