import type { Product, ProductImage, ProductOption, ProductPricing } from './product.js';

/** Public storefront view of a product — drops internal fields (status, showInShop,
 *  deletedAt, updatedAt) that the online shop has no business seeing. */
export interface ShopProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  options: ProductOption[];
  pricing: ProductPricing[];
  /** First image is the main one (shown on product cards). */
  images: ProductImage[];
  createdAt: string;
}

export function toShopProduct(product: Product): ShopProduct {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.description,
    options: product.options,
    pricing: product.pricing,
    images: product.images,
    createdAt: product.createdAt,
  };
}

/** A product is shop-visible only when it's Active, flagged for the shop and not soft-deleted. */
export function isShopVisible(product: Product): boolean {
  return product.status === 'Active' && product.showInShop && product.deletedAt === null;
}
