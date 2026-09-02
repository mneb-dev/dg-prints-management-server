export const ROLES = ['staff', 'admin', 'superadmin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSION_KEYS = [
  'manage_products',
  'manage_orders',
  'manage_users',
  'view_reports',
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
  createdAt: string;
  updatedAt: string;
}

export type UserInput = Partial<Omit<User, 'id' | 'createdAt' | 'updatedAt'>> & {
  password?: string;
};
