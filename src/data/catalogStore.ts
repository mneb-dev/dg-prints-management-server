import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';

export interface CatalogItem {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogItemUpdate {
  name?: string;
  enabled?: boolean;
}

interface CatalogRow {
  id: string;
  name: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const CATALOG_SELECT = 'id, name, enabled, sort_order, created_at, updated_at';

function mapRow(row: CatalogRow): CatalogItem {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Thrown by create/update when the name collides (case-insensitively) with another row in the same table. */
export class DuplicateCatalogItemError extends Error {
  constructor(name: string) {
    super(`"${name}" already exists.`);
    this.name = 'DuplicateCatalogItemError';
  }
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505';
}

/** Backs both payment_methods and order_channels — identical shape (name, enabled,
 * sort_order), so the CRUD + reorder logic is shared rather than duplicated per table. */
export function createCatalogStore(table: 'payment_methods' | 'order_channels') {
  async function list(): Promise<CatalogItem[]> {
    const { data, error } = await supabase
      .from(table)
      .select(CATALOG_SELECT)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as unknown as CatalogRow[]).map(mapRow);
  }

  async function create(name: string): Promise<CatalogItem> {
    const trimmed = name.trim();
    const { data: last, error: lastError } = await supabase
      .from(table)
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastError) throw new Error(lastError.message);

    const { data, error } = await supabase
      .from(table)
      .insert({
        id: randomUUID(),
        name: trimmed,
        enabled: true,
        sort_order: last ? last.sort_order + 1 : 0,
      })
      .select(CATALOG_SELECT)
      .single();
    if (error) {
      if (isUniqueViolation(error)) throw new DuplicateCatalogItemError(trimmed);
      throw new Error(error.message);
    }
    return mapRow(data as unknown as CatalogRow);
  }

  async function update(id: string, input: CatalogItemUpdate): Promise<CatalogItem | undefined> {
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.enabled !== undefined) patch.enabled = input.enabled;

    const { data, error } = await supabase
      .from(table)
      .update(patch)
      .eq('id', id)
      .select(CATALOG_SELECT)
      .maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) throw new DuplicateCatalogItemError(String(input.name));
      throw new Error(error.message);
    }
    return data ? mapRow(data as unknown as CatalogRow) : undefined;
  }

  async function remove(id: string): Promise<boolean> {
    const { error, count } = await supabase.from(table).delete({ count: 'exact' }).eq('id', id);
    if (error) throw new Error(error.message);
    return (count ?? 0) > 0;
  }

  /** Renumbers sort_order to match `ids`'s order. Deletion doesn't affect any existing
   * order row (channel/payment_method are historical text snapshots, not foreign keys),
   * so there's nothing to reconcile there — same reasoning applies to a rename. */
  async function reorder(ids: string[]): Promise<CatalogItem[]> {
    await Promise.all(
      ids.map((id, index) => supabase.from(table).update({ sort_order: index }).eq('id', id))
    );
    return list();
  }

  return { list, create, update, remove, reorder };
}
