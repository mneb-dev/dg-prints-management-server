import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';
import type { Category, CategoryInput, CommonSize, HotSizes } from '../types/category.js';

const CATEGORY_SELECT = 'id, name, active, status_flow, common_sizes, created_at, updated_at';

const DEFAULT_STATUS_FLOW = ['pending', 'released'];

interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
  status_flow: string[];
  common_sizes: CommonSize[];
  created_at: string;
  updated_at: string;
}

function mapRowToCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    statusFlow: row.status_flow,
    commonSizes: row.common_sizes ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Same drift problem the frontend's isStickerLabelCategory (order-line-item.ts) already
// handles: order_items.product_category is a historical per-item snapshot string, so
// aggregating "last N orders of Sticker Label" over real order history must match every
// name a category has ever been known by, not just its current live name.
const STICKER_LABEL_ALIASES = ['sticker', 'sticker label'];
const TARPAULIN_ALIASES = ['tarpaulin'];

function canonicalSizeKey(size: CommonSize): string {
  return `${size.unit}:${Math.min(size.width, size.height)}x${Math.max(size.width, size.height)}`;
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
      status_flow: input.statusFlow ?? DEFAULT_STATUS_FLOW,
      common_sizes: input.commonSizes ?? [],
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
  if (input.statusFlow !== undefined) update.status_flow = input.statusFlow;
  if (input.commonSizes !== undefined) update.common_sizes = input.commonSizes;

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

interface HotSizeRow extends CommonSize {
  count: number;
}

async function rankedHotSizes(aliases: string[]): Promise<HotSizeRow[]> {
  const { data, error } = await supabase.rpc('hot_sizes', {
    p_category_names: aliases,
    p_limit: 100,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as HotSizeRow[];
}

/** Top 5 hot sizes per category, skipping any candidate that duplicates one of that
 * category's admin-configured common sizes (orientation-insensitive, exact-unit match —
 * same rule the `hot_sizes` SQL function uses for its own grouping) so a chip never shows
 * the same size twice. Laminated Sticker has no bucket of its own here — the frontend
 * mirrors the Sticker Label bucket for it. */
export async function listHotSizes(): Promise<HotSizes> {
  const categories = await listCategories();
  const stickerLabelCategory = categories.find((c) => STICKER_LABEL_ALIASES.includes(c.name.trim().toLowerCase()));
  const tarpaulinCategory = categories.find((c) => TARPAULIN_ALIASES.includes(c.name.trim().toLowerCase()));

  async function topFiveExcluding(category: Category | undefined, aliases: string[]): Promise<CommonSize[]> {
    if (!category) return [];
    const excluded = new Set(category.commonSizes.map(canonicalSizeKey));
    const ranked = await rankedHotSizes(aliases);
    return ranked
      .filter((candidate) => !excluded.has(canonicalSizeKey(candidate)))
      .slice(0, 5)
      .map(({ width, height, unit }) => ({ width, height, unit }));
  }

  const [stickerLabel, tarpaulin] = await Promise.all([
    topFiveExcluding(stickerLabelCategory, STICKER_LABEL_ALIASES),
    topFiveExcluding(tarpaulinCategory, TARPAULIN_ALIASES),
  ]);

  return { stickerLabel, tarpaulin };
}
