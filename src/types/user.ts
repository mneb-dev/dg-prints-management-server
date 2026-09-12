export const ROLES = ['staff', 'admin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSION_KEYS = [
  'manage_products',
  'manage_orders',
  'manage_users',
  'manage_expenses',
  'manage_settings',
  'manage_incentives',
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const USER_STATUSES = ['active', 'inactive'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface User {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  role: Role;
  permissions: PermissionKey[];
  avatar: string | null;
  status: UserStatus;
  commissionRate: number;
  dailyRate: number | null;
  createdAt: string;
  updatedAt: string;
}

export type UserInput = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>> & {
  password?: string;
};

// Lean projection for non-admin-gated pickers (e.g. the order "Layout by" field) —
// no role/permissions/username exposed.
export interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
}
