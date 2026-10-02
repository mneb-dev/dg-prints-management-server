-- Online shop convenience fee: a percentage added at checkout when the buyer pays online through
-- PayMongo, to cover PayMongo's own fee. Charged on items + shipping and stored on the order as
-- additional_fees (with a note). 0 = off.
alter table app_settings
  add column if not exists convenience_fee_percent numeric(5, 2) not null default 0;
