import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { supabase } from '../config/supabaseClient.js';
import type { PermissionKey, Role, User, UserInput } from '../types/user.js';

const PUBLIC_USER_SELECT =
  'id, first_name, last_name, username, role, permissions, avatar, created_at, updated_at';

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  role: Role;
  permissions: PermissionKey[];
  avatar: string | null;
  created_at: string;
  updated_at: string;
}

interface UserRowWithHash extends UserRow {
  password_hash: string;
}

function mapRowToUser(row: UserRow): User {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    role: row.role,
    permissions: row.permissions ?? [],
    avatar: row.avatar,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ListUsersParams {
  page: number;
  pageSize: number | null;
  search?: string;
  role?: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export interface ListUsersResult {
  items: User[];
  total: number;
  page: number;
  pageSize: number | null;
}

export async function listUsers(params: ListUsersParams): Promise<ListUsersResult> {
  const { page, pageSize, search, role, sortBy, sortDir } = params;
  const { data, error } = await supabase.rpc('list_users', {
    p_search: search || null,
    p_role: role || null,
    p_limit: pageSize,
    p_offset: pageSize === null ? 0 : (page - 1) * pageSize,
    p_sort_by: sortBy,
    p_sort_dir: sortDir,
  });
  if (error) throw new Error(error.message);
  const payload = data as unknown as { rows: UserRow[]; total: number };
  return {
    items: payload.rows.map(mapRowToUser),
    total: payload.total,
    page,
    pageSize,
  };
}

export async function getUser(id: string): Promise<User | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select(PUBLIC_USER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRowToUser(data as unknown as UserRow) : undefined;
}

/**
 * Includes password_hash. Used only by routes/auth.ts for login — never
 * import this into routes/users.ts or any handler that returns to the client.
 */
export async function getUserByUsernameWithHash(
  username: string
): Promise<UserRowWithHash | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select(`${PUBLIC_USER_SELECT}, password_hash`)
    .ilike('username', username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as UserRowWithHash) ?? undefined;
}

/**
 * Includes password_hash. Used only by routes/auth.ts's change-password
 * handler, which has the caller's id (from the JWT) but not their username.
 */
export async function getUserByIdWithHash(id: string): Promise<UserRowWithHash | undefined> {
  const { data, error } = await supabase
    .from('users')
    .select(`${PUBLIC_USER_SELECT}, password_hash`)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as UserRowWithHash) ?? undefined;
}

export async function createUser(input: UserInput): Promise<User> {
  if (!input.password) throw new Error('"password" is required');
  const passwordHash = await bcrypt.hash(input.password, 10);

  const { data, error } = await supabase
    .from('users')
    .insert({
      id: randomUUID(),
      first_name: input.firstName ?? '',
      last_name: input.lastName ?? '',
      username: input.username ?? '',
      password_hash: passwordHash,
      role: input.role ?? 'staff',
      permissions: input.permissions ?? [],
      avatar: input.avatar ?? null,
    })
    .select(PUBLIC_USER_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return mapRowToUser(data as unknown as UserRow);
}

export async function updateUser(id: string, input: UserInput): Promise<User | undefined> {
  const update: Record<string, unknown> = {};
  if (input.firstName !== undefined) update.first_name = input.firstName;
  if (input.lastName !== undefined) update.last_name = input.lastName;
  if (input.username !== undefined) update.username = input.username;
  if (input.role !== undefined) update.role = input.role;
  if (input.permissions !== undefined) update.permissions = input.permissions;
  if (input.avatar !== undefined) update.avatar = input.avatar;
  if (input.password) update.password_hash = await bcrypt.hash(input.password, 10);

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .select(PUBLIC_USER_SELECT)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRowToUser(data as unknown as UserRow) : undefined;
}

export async function deleteUser(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('users').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
