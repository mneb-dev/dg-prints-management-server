import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';
import type { Category, CategoryInput } from '../types/category.js';

const CATEGORY_SELECT = 'id, name, active, created_at, updated_at';

interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function mapRowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Thrown by createCategory/updateCategory when the name collides (case-insensitively) with another category. */
export class DuplicateCategoryNameError extends Error {
  constructor(name: string) {
    super(`A category named "${name}" already exists.`);
    this.name = 'DuplicateCategoryNameError';
  }
}

function isUniqueViolation(error: { code?: string; message: string }): boolean {
  return error.code === '23505' || error.message.includes('categories_name_key');
}

export async function listCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_SELECT)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data as unknown as CategoryRow[]).map(mapRowToCategory);
}

export async function getCategory(id: string): Promise<Category | undefined> {
  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRowToCategory(data as unknown as CategoryRow) : undefined;
}

export async function createCategory(input: CategoryInput): Promise<Category> {
  const name = (input.name ?? '').trim();
  const { data, error } = await supabase
    .from('categories')
    .insert({
      id: randomUUID(),
      name,
      active: input.active ?? true,
    })
    .select(CATEGORY_SELECT)
    .single();
  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateCategoryNameError(name);
    throw new Error(error.message);
  }
  return mapRowToCategory(data as unknown as CategoryRow);
}

export async function updateCategory(
  id: string,
  input: CategoryInput
): Promise<Category | undefined> {
  const existing = await getCategory(id);
  if (!existing) return undefined;

  const update: Record<string, unknown> = {};
  const trimmedName = input.name !== undefined ? input.name.trim() : undefined;
  if (trimmedName !== undefined) update.name = trimmedName;
  if (input.active !== undefined) update.active = input.active;

  const { data, error } = await supabase
    .from('categories')
    .update(update)
    .eq('id', id)
    .select(CATEGORY_SELECT)
    .maybeSingle();
  if (error) {
    if (isUniqueViolation(error)) throw new DuplicateCategoryNameError(trimmedName ?? existing.name);
    throw new Error(error.message);
  }
  if (!data) return undefined;

  // products.category is a live reference (unlike order_items.product_category,
  // which is an intentional historical snapshot) — keep existing products in
  // sync with a rename.
  if (trimmedName !== undefined && trimmedName !== existing.name) {
    const { error: cascadeError } = await supabase
      .from('products')
      .update({ category: trimmedName })
      .eq('category', existing.name);
    if (cascadeError) throw new Error(cascadeError.message);
  }

  return mapRowToCategory(data as unknown as CategoryRow);
}

export async function countProductsInCategory(name: string): Promise<number> {
  const { count, error } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category', name);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface DeleteCategoryResult {
  deleted: boolean;
  /** Present only when deletion was blocked because the category is still in use. */
  inUseCount?: number;
  name?: string;
}

export async function deleteCategory(id: string): Promise<DeleteCategoryResult> {
  const existing = await getCategory(id);
  if (!existing) return { deleted: false };

  const inUseCount = await countProductsInCategory(existing.name);
  if (inUseCount > 0) {
    return { deleted: false, inUseCount, name: existing.name };
  }

  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { deleted: true };
}
