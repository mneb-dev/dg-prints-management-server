-- Grandfather existing users into the new manage_expenses permission (Expenses previously had
-- no permission gate at all), and drop the removed, never-enforced view_reports permission.
update users
set permissions = array_append(permissions, 'manage_expenses')
where not ('manage_expenses' = any(permissions));

update users
set permissions = array_remove(permissions, 'view_reports')
where 'view_reports' = any(permissions);
