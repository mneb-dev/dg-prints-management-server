-- Category and order-status management moves from manage_products to its own manage_categories
-- permission. Grandfather everyone who can manage products today so nobody loses access on deploy;
-- admins can revoke it per-user afterward. Apply before deploying the server change.
update users
set permissions = array_append(permissions, 'manage_categories')
where 'manage_products' = any(permissions)
  and not ('manage_categories' = any(permissions));
