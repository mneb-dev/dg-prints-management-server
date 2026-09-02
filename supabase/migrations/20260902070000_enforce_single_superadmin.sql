-- Enforce at most one superadmin account at a time via a partial unique
-- index: only rows where role = 'superadmin' participate, so any number of
-- 'staff'/'admin' rows can coexist, but a second 'superadmin' row
-- insert/update collides. Verified via live data query (2026-09-02):
-- exactly 1 existing superadmin, 2 admin, 4 staff — no cleanup needed.
create unique index if not exists users_single_superadmin_key
  on users (role)
  where role = 'superadmin';
