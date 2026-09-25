import type { Product, ProductPricing } from '../types/product.js';

/** Area-priced entry: the buyer enters width × height (feet). Mirrors the shop's `isAreaPriced`. */
export function isAreaPriced(entry: Pick<ProductPricing, 'pricingType' | 'unit'>): boolean {
  return entry.pricingType === 'Per Unit' && entry.unit === 'sq.ft.';
}

/** Same formula as the shop's and portal's `computeLineTotal`. */
export function computeLineTotal(
  pricing: { pricingType: string; unitPrice: number; width?: number; height?: number },
  quantity: number
): number {
  if (pricing.pricingType === 'Per Unit' && pricing.width && pricing.height) {
    return pricing.width * pricing.height * pricing.unitPrice * quantity;
  }
  return pricing.unitPrice * quantity;
}

/** Whether a pricing entry applies to the chosen option values (optionId → value). */
export function appliesToSelection(entry: ProductPricing, selected: Map<string, string>): boolean {
  if (entry.appliesTo === 'All') return true;
  return entry.appliesTo.every((condition) => selected.get(condition.optionId) === condition.value);
}

/** Finds the entry a cart line was priced with: by id when the cart has it, otherwise (carts saved
 *  before ids were stored) by type + package + price among the entries that fit the selection. */
export function findPricingEntry(
  product: Product,
  selected: Map<string, string>,
  line: { pricingEntryId?: string; pricingType?: string; packageName?: string; unitPrice?: number }
): ProductPricing | undefined {
  const candidates = product.pricing.filter((entry) => appliesToSelection(entry, selected));
  if (line.pricingEntryId) return candidates.find((entry) => entry.id === line.pricingEntryId);
  return candidates.find(
    (entry) =>
      entry.pricingType === line.pricingType &&
      (entry.packageName ?? '') === (line.packageName ?? '') &&
      entry.price === line.unitPrice
  ) ?? (candidates.length === 1 ? candidates[0] : undefined);
}
