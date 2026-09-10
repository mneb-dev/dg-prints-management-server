-- New payroll feature. Grandfather existing users into manage_payroll, same rollout pattern as
-- manage_expenses (20260906090000) and manage_commissions (20260910160000) -- so staff who have a
-- salary_amount configured see their own payroll history immediately, and admins/superadmins
-- aren't locked out of a page they'll expect to have on day one. Note this only controls who can
-- open the page/see pay figures -- creating/deleting a run additionally requires the
-- admin/superadmin role regardless of this permission (see routes/payroll.ts). Admins can revoke
-- per-user afterward.
update users
set permissions = array_append(permissions, 'manage_payroll')
where not ('manage_payroll' = any(permissions));
