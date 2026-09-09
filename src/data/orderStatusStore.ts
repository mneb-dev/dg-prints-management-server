import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';
import type { OrderStatus, OrderStatusInput } from '../types/orderStatus.js';

const ORDER_STATUS_SELECT =
  'id, name, label, icon, color, protected, enabled, sort_order, created_at, updated_at';

interface OrderStatusRow {
  id: string;
  name: string;
  label: string;
  icon: string;
  color: string;
  protected: boolean;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

function mapRow(row: OrderStatusRow): OrderStatus {
  return {
    id: row.id,
    name: row.name,
    label: row.label,
    icon: row.icon,
    color: row.color,
    protected: row.protected,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Thrown by create/update when the name collides (case-insensitively) with another status. */
export class DuplicateOrderStatusNameError extends Error {
  constructor(name: string) {
    super(`An order status named "${name}" already exists.`);
    this.name = 'DuplicateOrderStatusNameError';
  }
}

/** Thrown when renaming or deleting one of the 5 built-in statuses (pending/released/
 * cancelled/refunded/returned) — their exact name is depended on elsewhere (mandatory
 * category-flow membership, dedicated Cancel/Refund/Return confirmation dialogs). */
export class ProtectedOrderStatusError extends Error {
  constructor(name: string, action: 'rename' | 'delete') {
    super(`Cannot ${action} "${name}"; it is a built-in status.`);
    this.name = 'ProtectedOrderStatusError';
  }
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

export async function listOrderStatuses(): Promise<OrderStatus[]> {
  const { data, error } = await supabase
    .from('order_statuses')
    .select(ORDER_STATUS_SELECT)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as unknown as OrderStatusRow[]).map(mapRow);
}

export async function getOrderStatus(id: string): Promise<OrderStatus | undefined> {
  const { data, error } = await supabase
    .from('order_statuses')
    .select(ORDER_STATUS_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRow(data as unknown as OrderStatusRow) : undefined;
}

export async function createOrderStatus(input: {
  name: string;
  label: string;
  icon?: string;
  color?: string;
}): Promise<OrderStatus> {
  const name = input.name.trim();
  const label = input.label.trim();

  const { data: last, error: lastError } = await supabase
    .from('order_statuses')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(lastError.message);

  const { data, error } = await supabase
    .from('order_statuses')
    .insert({
      id: randomUUID(),
      name,
      label,
      icon: input.icon?.trim() || 'circle',
      color: input.color?.trim() || 'slot-1',
      protected: false,
      enabled: true,
      sort_order: last ? last.sort_order + 1 : 0,
    })
    .select(ORDER_STATUS_SELECT)
    .single();
  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateOrderStatusNameError(name);
    throw new Error(error.message);
  }
  return mapRow(data as unknown as OrderStatusRow);
}

export async function updateOrderStatus(
  id: string,
  input: OrderStatusInput
): Promise<OrderStatus | undefined> {
  const existing = await getOrderStatus(id);
  if (!existing) return undefined;

  const trimmedName = input.name !== undefined ? input.name.trim() : undefined;
  const isRename = trimmedName !== undefined && trimmedName !== existing.name;
  if (isRename && existing.protected) {
    throw new ProtectedOrderStatusError(existing.name, 'rename');
  }

  const patch: Record<string, unknown> = {};
  if (trimmedName !== undefined) patch.name = trimmedName;
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.icon !== undefined) patch.icon = input.icon.trim() || 'circle';
  if (input.color !== undefined) patch.color = input.color.trim() || 'slot-1';
  if (input.enabled !== undefined) patch.enabled = input.enabled;

  const { data, error } = await supabase
    .from('order_statuses')
    .update(patch)
    .eq('id', id)
    .select(ORDER_STATUS_SELECT)
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateOrderStatusNameError(trimmedName ?? existing.name);
    throw new Error(error.message);
  }
  if (!data) return undefined;

  // orders.status is a live/current field (unlike order_channels/payment_methods, which
  // are intentional historical snapshots) — keep it, and any category's status_flow, in
  // sync with a rename, same reasoning as categoryStore's cascade to products.category.
  // Only ever runs for non-protected rows (guarded above). Not wrapped in a transaction
  // (Supabase JS has no ad-hoc multi-statement transactions here either, same as the
  // category cascade) — a rename racing a same-name order create has a narrow window to
  // leave that one order on the stale name.
  if (isRename && trimmedName !== undefined) {
    const { error: ordersCascadeError } = await supabase
      .from('orders')
      .update({ status: trimmedName })
      .eq('status', existing.name);
    if (ordersCascadeError) throw new Error(ordersCascadeError.message);

    const { data: affectedCategories, error: categoriesLookupError } = await supabase
      .from('categories')
      .select('id, status_flow')
      .contains('status_flow', [existing.name]);
    if (categoriesLookupError) throw new Error(categoriesLookupError.message);

    for (const category of (affectedCategories ?? []) as { id: string; status_flow: string[] }[]) {
      const updatedFlow = category.status_flow.map((s) => (s === existing.name ? trimmedName : s));
      const { error: flowCascadeError } = await supabase
        .from('categories')
        .update({ status_flow: updatedFlow })
        .eq('id', category.id);
      if (flowCascadeError) throw new Error(flowCascadeError.message);
    }
  }

  return mapRow(data as unknown as OrderStatusRow);
}

export async function countOrdersWithStatus(name: string): Promise<number> {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('status', name);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface DeleteOrderStatusResult {
  deleted: boolean;
  /** Present only when deletion was blocked because the status is still in use. */
  inUseCount?: number;
  /** Present only when deletion was blocked because the status is a built-in one. */
  protected?: boolean;
  name?: string;
}

export async function deleteOrderStatus(id: string): Promise<DeleteOrderStatusResult> {
  const existing = await getOrderStatus(id);
  if (!existing) return { deleted: false };

  if (existing.protected) {
    return { deleted: false, protected: true, name: existing.name };
  }

  const inUseCount = await countOrdersWithStatus(existing.name);
  if (inUseCount > 0) {
    return { deleted: false, inUseCount, name: existing.name };
  }

  const { error } = await supabase.from('order_statuses').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { deleted: true };
}

/** Renumbers sort_order to match `ids`'s order. */
export async function reorderOrderStatuses(ids: string[]): Promise<OrderStatus[]> {
  await Promise.all(
    ids.map((id, index) => supabase.from('order_statuses').update({ sort_order: index }).eq('id', id))
  );
  return listOrderStatuses();
}
