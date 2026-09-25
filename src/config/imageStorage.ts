import { supabase } from './supabaseClient.js';

export const PRODUCT_IMAGES_BUCKET = 'product-images';

/** Where product image files live. Stores depend on this interface rather than on Supabase
 *  Storage directly, so the provider can be swapped without touching them. */
export interface ImageStorage {
  /** A one-time URL the browser PUTs the file to directly (bypassing this server's body limit). */
  createUploadUrl(path: string): Promise<string>;
  /** Public URL for a stored object. Pure string build — no network call. */
  publicUrl(path: string): string;
  exists(path: string): Promise<boolean>;
  remove(paths: string[]): Promise<void>;
}

function bucket() {
  return supabase.storage.from(PRODUCT_IMAGES_BUCKET);
}

export const imageStorage: ImageStorage = {
  async createUploadUrl(path) {
    const { data, error } = await bucket().createSignedUploadUrl(path);
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  publicUrl(path) {
    return bucket().getPublicUrl(path).data.publicUrl;
  },

  async exists(path) {
    const { data, error } = await bucket().exists(path);
    return !error && data;
  },

  async remove(paths) {
    if (paths.length === 0) return;
    const { error } = await bucket().remove(paths);
    if (error) throw new Error(error.message);
  },
};
