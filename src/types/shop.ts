import { withConvenienceFee } from '../utils/shopPricing.js';
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
  /** True: the shop shows "Message us on Facebook" (no options, not added to the cart).
   *  False: options + "Add to cart". */
  madeToOrder: boolean;
  /** False when staff marked the product Inactive — the shop still lists it, as "Out of stock". */
  inStock: boolean;
  createdAt: string;
}

/** `convenienceFeePercent` is baked into every price (see `withConvenienceFee`), so the shop's
 *  cards, product page, cart and checkout all show what the buyer will pay. Made-to-order products
 *  are ordered through Messenger, never paid online, so they keep their original prices. */
export function toShopProduct(product: Product, convenienceFeePercent: number): ShopProduct {
  const feePercent = product.madeToOrder ? 0 : convenienceFeePercent;
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    description: product.description,
    options: product.options,
    pricing: product.pricing.map((entry) => ({ ...entry, price: withConvenienceFee(entry.price, feePercent) })),
    images: product.images,
    madeToOrder: product.madeToOrder,
    inStock: product.status === 'Active',
    createdAt: product.createdAt,
  };
}

/** A product is shop-visible when it's flagged for the shop and not soft-deleted. Inactive
 *  products stay listed but show as "Out of stock" (see `ShopProduct.inStock`). */
export function isShopVisible(product: Product): boolean {
  return product.showInShop && product.deletedAt === null;
}

/** Public storefront settings — only what the shop needs. */
export interface ShopSettings {
  messengerUrl: string;
  /** The online-payment processing fee baked into shop prices (0 = off) — disclosed on the shop's
   * Terms page. */
  convenienceFeePercent: number;
}
