import { randomUUID } from 'node:crypto';

import { supabase } from '../config/supabaseClient.js';
import type { Product, ProductInput, ProductOption, ProductPricing } from '../types/product.js';

type AppliesTo = ProductPricing['appliesTo'];

interface ValueRow {
  id: string;
  value: string;
  sort_order: number;
}

interface OptionRow {
  id: string;
  name: string;
  required: boolean;
  sort_order: number;
  values: ValueRow[];
}

interface PricingRow {
  id: string;
  applies_to: AppliesTo;
  pricing_type: string;
  package_name: string | null;
  price: number | string;
  unit: string;
  sort_order: number;
}

interface ProductRow {
  id: string;
  name: string;
  category: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  options: OptionRow[];
  pricing: PricingRow[];
}

const PRODUCT_SELECT = `
  id, name, category, description, status, created_at, updated_at,
  options:product_options ( id, name, required, sort_order,
    values:product_option_values ( id, value, sort_order ) ),
  pricing:product_pricing ( id, applies_to, pricing_type, package_name, price, unit, sort_order )
`;

function mapRowToProduct(row: ProductRow): Product {
  const options = [...row.options]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((option) => ({
      id: option.id,
      name: option.name,
      required: option.required,
      values: [...option.values]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((value) => value.value),
    }));

  const pricing = [...row.pricing]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((entry) => ({
      id: entry.id,
      appliesTo: entry.applies_to,
      pricingType: entry.pricing_type,
      packageName: entry.package_name ?? undefined,
      price: Number(entry.price),
      unit: entry.unit,
    }));

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    status: row.status,
    options,
    pricing,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRpcPayload(product: Product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.description,
    status: product.status,
    options: product.options.map((option, index) => ({
      id: option.id,
      name: option.name,
      required: option.required,
      sort_order: index,
      values: option.values.map((value, valueIndex) => ({ value, sort_order: valueIndex })),
    })),
    pricing: product.pricing.map((entry, index) => ({
      id: entry.id,
      applies_to: entry.appliesTo,
      pricing_type: entry.pricingType,
      package_name: entry.packageName ?? null,
      price: entry.price,
      unit: entry.unit,
      sort_order: index,
    })),
  };
}

function normalizeOptions(
  options: ProductInput['options'],
  forceNewIds = false
): { options: ProductOption[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const normalized = (options ?? []).map((option) => {
    const id = forceNewIds ? randomUUID() : option.id ?? randomUUID();
    if (option.id) idMap.set(option.id, id);
    return {
      id,
      name: option.name ?? '',
      required: option.required ?? false,
      values: option.values ?? [],
    };
  });
  return { options: normalized, idMap };
}

// `normalizeOptions` mints fresh option ids on create (and can on update, for
// brand-new options), so any `appliesTo` condition referencing the id the
// client sent must be rewritten to the id actually stored — otherwise
// pricing rows are silently orphaned from their options.
function remapAppliesTo(appliesTo: AppliesTo | undefined, idMap: Map<string, string>): AppliesTo {
  if (!appliesTo || appliesTo === 'All') return appliesTo ?? 'All';
  return appliesTo.map((condition) => ({
    ...condition,
    optionId: idMap.get(condition.optionId) ?? condition.optionId,
  }));
}

function normalizePricing(
  pricing: ProductInput['pricing'],
  idMap: Map<string, string>,
  forceNewIds = false
): ProductPricing[] {
  return (pricing ?? []).map((entry) => ({
    id: forceNewIds ? randomUUID() : entry.id ?? randomUUID(),
    appliesTo: remapAppliesTo(entry.appliesTo, idMap),
    pricingType: entry.pricingType ?? 'Package',
    packageName: entry.packageName,
    price: entry.price ?? 0,
    unit: entry.unit ?? 'Package',
  }));
}

export interface ListProductsParams {
  page: number;
  pageSize: number | null;
  search?: string;
  category?: string;
  status?: string;
  pricingType?: string;
  sortBy: string;
  sortDir: 'asc' | 'desc';
}

export interface ListProductsResult {
  items: Product[];
  total: number;
  page: number;
  pageSize: number | null;
}

export async function listProducts(params: ListProductsParams): Promise<ListProductsResult> {
  const { page, pageSize, search, category, status, pricingType, sortBy, sortDir } = params;
  const { data, error } = await supabase.rpc('list_products', {
    p_search: search || null,
    p_category: category || null,
    p_status: status || null,
    p_pricing_type: pricingType || null,
    p_limit: pageSize,
    p_offset: pageSize === null ? 0 : (page - 1) * pageSize,
    p_sort_by: sortBy,
    p_sort_dir: sortDir,
  });
  if (error) throw new Error(error.message);
  const payload = data as unknown as { rows: ProductRow[]; total: number };
  return {
    items: payload.rows.map(mapRowToProduct),
    total: payload.total,
    page,
    pageSize,
  };
}

export async function getProduct(id: string): Promise<Product | undefined> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapRowToProduct(data as unknown as ProductRow) : undefined;
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const now = new Date().toISOString();
  const { options, idMap } = normalizeOptions(input.options, true);
  const product: Product = {
    id: randomUUID(),
    name: input.name ?? '',
    category: input.category ?? '',
    description: input.description ?? '',
    status: input.status ?? 'Active',
    options,
    pricing: normalizePricing(input.pricing, idMap, true),
    createdAt: now,
    updatedAt: now,
  };

  const { error } = await supabase.rpc('upsert_product', { payload: toRpcPayload(product) });
  if (error) throw new Error(error.message);

  const created = await getProduct(product.id);
  if (!created) throw new Error('Failed to load created product');
  return created;
}

export async function updateProduct(
  id: string,
  input: ProductInput
): Promise<Product | undefined> {
  const existing = await getProduct(id);
  if (!existing) return undefined;

  const { options, idMap } = input.options
    ? normalizeOptions(input.options)
    : { options: existing.options, idMap: new Map<string, string>() };

  const updated: Product = {
    ...existing,
    ...input,
    options,
    pricing: input.pricing ? normalizePricing(input.pricing, idMap) : existing.pricing,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const { error } = await supabase.rpc('upsert_product', { payload: toRpcPayload(updated) });
  if (error) throw new Error(error.message);

  const result = await getProduct(id);
  if (!result) throw new Error('Failed to load updated product');
  return result;
}

export async function deleteProduct(id: string): Promise<boolean> {
  const { data, error } = await supabase.from('products').delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}
