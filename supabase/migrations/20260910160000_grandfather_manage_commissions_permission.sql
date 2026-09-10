-- New commission-reporting feature. Grandfather existing users into manage_commissions so staff
-- who do layout work see their own commission immediately, rather than being locked out until an
-- admin manually grants every account -- same rollout pattern as manage_expenses in
-- 20260906090000_update_user_permissions.sql. Admins can revoke it per-user afterward.
update users
set permissions = array_append(permissions, 'manage_commissions')
where not ('manage_commissions' = any(permissions));
