import { randomUUID } from 'node:crypto';

import { imageStorage } from '../config/imageStorage.js';
import { supabase } from '../config/supabaseClient.js';
import type { ProductImage } from '../types/product.js';

export const MAX_PRODUCT_IMAGES = 8;

/** A client-caused failure the route turns into a 4xx instead of the generic 500. */
export class ProductImageError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

interface ImageRow {
  id: string;
  storage_path: string;
  sort_order: number;
}

function toProductImage(row: ImageRow): ProductImage {
  return { id: row.id, url: imageStorage.publicUrl(row.storage_path) };
}

function productPrefix(productId: string): string {
  return `products/${productId}/`;
}

async function assertProductExists(productId: string): Promise<void> {
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .eq('id', productId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ProductImageError(404, `Product not found: ${productId}`);
}

async function listImageRows(productId: string): Promise<ImageRow[]> {
  const { data, error } = await supabase
    .from('product_images')
    .select('id, storage_path, sort_order')
    .eq('product_id', productId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data as ImageRow[];
}

async function assertBelowLimit(productId: string): Promise<ImageRow[]> {
  const rows = await listImageRows(productId);
  if (rows.length >= MAX_PRODUCT_IMAGES) {
    throw new ProductImageError(409, `A product can have at most ${MAX_PRODUCT_IMAGES} images`);
  }
  return rows;
}

export async function listProductImages(productId: string): Promise<ProductImage[]> {
  return (await listImageRows(productId)).map(toProductImage);
}

/** Step 1 of an upload: reserve a storage path under the product and hand back a signed URL
 *  the browser PUTs the (already resized, WebP) file to. */
export async function createUploadTarget(productId: string): Promise<{ uploadUrl: string; path: string }> {
  await assertProductExists(productId);
  await assertBelowLimit(productId);
  const path = `${productPrefix(productId)}${randomUUID()}.webp`;
  const uploadUrl = await imageStorage.createUploadUrl(path);
  return { uploadUrl, path };
}

/** Step 2 of an upload: once the file is in storage, record it against the product (appended
 *  last — the first image is the main one). */
export async function addProductImage(productId: string, path: string): Promise<ProductImage> {
  if (!path.startsWith(productPrefix(productId)) || path.includes('..')) {
    throw new ProductImageError(400, '"path" does not belong to this product');
  }
  await assertProductExists(productId);
  const rows = await assertBelowLimit(productId);
  if (!(await imageStorage.exists(path))) {
    throw new ProductImageError(400, 'Uploaded file not found in storage');
  }

  const nextOrder = rows.length === 0 ? 0 : Math.max(...rows.map((row) => row.sort_order)) + 1;
  const { data, error } = await supabase
    .from('product_images')
    .insert({ product_id: productId, storage_path: path, sort_order: nextOrder })
    .select('id, storage_path, sort_order')
    .single();
  if (error) {
    // Unique storage_path: the same upload was registered twice.
    if (error.code === '23505') throw new ProductImageError(409, 'Image already registered');
    throw new Error(error.message);
  }
  return toProductImage(data as ImageRow);
}

/** Rewrites sort_order to match `imageIds` (which must be exactly the product's image set).
 *  Putting an image first makes it the main image. */
export async function reorderProductImages(productId: string, imageIds: string[]): Promise<ProductImage[]> {
  const rows = await listImageRows(productId);
  const existing = new Set(rows.map((row) => row.id));
  const isExactSet =
    imageIds.length === existing.size &&
    new Set(imageIds).size === imageIds.length &&
    imageIds.every((id) => existing.has(id));
  if (!isExactSet) {
    throw new ProductImageError(400, '"imageIds" must list every image of this product exactly once');
  }

  const results = await Promise.all(
    imageIds.map((id, index) =>
      supabase.from('product_images').update({ sort_order: index }).eq('id', id).eq('product_id', productId)
    )
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message);

  return listProductImages(productId);
}

export async function deleteProductImage(productId: string, imageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('product_images')
    .delete()
    .eq('id', imageId)
    .eq('product_id', productId)
    .select('storage_path');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return false;

  // The row is already gone, so a failed file cleanup only leaves an orphaned object behind.
  try {
    await imageStorage.remove(data.map((row) => row.storage_path as string));
  } catch (err) {
    console.error('Failed to remove product image from storage', err);
  }
  return true;
}
