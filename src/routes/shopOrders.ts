import { randomUUID } from 'node:crypto';

import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { PAYMONGO_SECRET_KEY, SHOP_URL, SUPABASE_URL } from '../config/env.js';
import { buildOrder, createOrder, toRpcPayload } from '../data/orderStore.js';
import { getProduct } from '../data/productStore.js';
import { getSettings } from '../data/settingsStore.js';
import { attachCheckoutSession, createShopCheckout, expireShopCheckout } from '../data/shopCheckoutStore.js';
import type { OrderInput, OrderItem, OrderItemInput } from '../types/order.js';
import { isShopVisible } from '../types/shop.js';
import { createCheckoutSession } from '../utils/paymongo.js';
import { isValidPhMobileNumber } from '../utils/phPhone.js';
import { regionOfProvince } from '../utils/phProvinces.js';
import { computeLineTotal, findPricingEntry, isAreaPriced } from '../utils/shopPricing.js';
import { isUuid } from '../utils/uuid.js';

// Public checkout for the online shop. Every price is re-resolved from the database — the client's
// prices are only compared against, never trusted. A fully-priced cart becomes a pending shop
// checkout plus a PayMongo Checkout Session (the order is created, paid, once the payment lands —
// see shopCheckouts.ts / paymongoWebhook.ts); a cart with a price-on-request line becomes a normal
// pending/unpaid order right away for staff to quote.
const router = Router();

export const SHOP_ORDER_CHANNEL = 'Online shop';
const MAX_ITEMS = 50;
const MAX_QUANTITY = 9999;
const MAX_ITEM_NOTE = 60; // Same limit the portal enforces on order item notes.
const MAX_DIMENSION_FT = 1000;

// Per server instance (Vercel may run several) — enough to stop casual spam, with the honeypot below.
const placeOrderLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: Number(process.env.SHOP_ORDER_RATE_LIMIT ?? 5),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Only placed orders count, so a buyer fixing typos (400) or cart issues (409) isn't locked out.
  skipFailedRequests: true,
  message: { error: 'Too many orders from this device. Please try again in a few minutes.' },
});

type Body = {
  customer?: { name?: unknown; phone?: unknown };
  address?: { street?: unknown; barangay?: unknown; city?: unknown; province?: unknown; zip?: unknown };
  items?: unknown;
  website?: unknown;
};

type LineInput = {
  productId?: unknown;
  pricingEntryId?: unknown;
  pricingType?: unknown;
  packageName?: unknown;
  unitPrice?: unknown;
  width?: unknown;
  height?: unknown;
  selectedOptions?: unknown;
  quantity?: unknown;
  note?: unknown;
};

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

const optionalString = (value: unknown) => (typeof value === 'string' ? value : undefined);
const optionalNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const roundToCentavo = (amount: number) => Math.round(amount * 100) / 100;

const REGION_LABELS = { luzon: 'Luzon', visayas: 'Visayas', mindanao: 'Mindanao' } as const;

// Thumbnail for the shipping row on PayMongo's page, so it doesn't look like a product. Uploaded by
// hand to each environment's public product-images bucket (dev and prod are separate projects).
const SHIPPING_IMAGE_URL = `${SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/product-images/static/shipping.png`;

/** Second line under a product on PayMongo's page, e.g. "Size: A4 · Matte · 2 × 3 ft". */
function lineDescription(item: OrderItem): string | undefined {
  const parts = item.selectedOptions.map((option) => `${option.optionName}: ${option.value}`);
  const { width, height, packageName } = item.pricing;
  if (packageName) parts.push(packageName);
  if (width && height) parts.push(`${width} × ${height} ft`);
  return parts.length > 0 ? parts.join(' · ').slice(0, 255) : undefined;
}

/** A cart line the shop must fix before ordering (removed/changed product or price). */
class LineConflict extends Error {
  constructor(
    readonly itemIndex: number,
    message: string
  ) {
    super(message);
  }
}

/** Resolves one cart line; also records the product's main photo in `images` for the payment page. */
async function resolveLine(raw: LineInput, index: number, images: Map<string, string>): Promise<OrderItemInput> {
  const productId = typeof raw.productId === 'string' && isUuid(raw.productId) ? raw.productId : null;
  const product = productId ? await getProduct(productId) : undefined;
  if (!product || !isShopVisible(product)) throw new LineConflict(index, 'This item is no longer available.');
  if (product.images[0]?.url) images.set(product.id, product.images[0].url);
  if (product.status !== 'Active') throw new LineConflict(index, `${product.name} is out of stock.`);
  if (product.madeToOrder) throw new LineConflict(index, `${product.name} is made to order — please message us to order it.`);

  const quantity = raw.quantity;
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new LineConflict(index, `Enter a quantity between 1 and ${MAX_QUANTITY} for ${product.name}.`);
  }
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (note.length > MAX_ITEM_NOTE) throw new LineConflict(index, `Notes must be at most ${MAX_ITEM_NOTE} characters.`);

  // Options arrive as { name, value }; map them to this product's option ids.
  const chosen = Array.isArray(raw.selectedOptions) ? (raw.selectedOptions as { name?: unknown; value?: unknown }[]) : [];
  const selectedOptions = [];
  const selectedById = new Map<string, string>();
  for (const pick of chosen) {
    const option = product.options.find((candidate) => candidate.name === pick?.name);
    if (!option || typeof pick.value !== 'string' || !option.values.includes(pick.value)) {
      throw new LineConflict(index, `The options for ${product.name} have changed. Please add it to your cart again.`);
    }
    selectedOptions.push({ optionId: option.id, optionName: option.name, value: pick.value });
    selectedById.set(option.id, pick.value);
  }
  if (product.options.some((option) => option.required && !selectedById.has(option.id))) {
    throw new LineConflict(index, `The options for ${product.name} have changed. Please add it to your cart again.`);
  }

  const base = {
    productId: product.id,
    productName: product.name,
    productCategory: product.category,
    selectedOptions,
    quantity,
    notes: note,
  };

  // "Price on request" product: staff quote it, same as a manual line in the portal.
  if (product.pricing.length === 0) {
    return { ...base, pricing: { pricingType: 'Manual', pricingEntryId: '', unitPrice: 0, unit: '' }, lineTotal: 0 };
  }

  const entry = findPricingEntry(product, selectedById, {
    pricingEntryId: optionalString(raw.pricingEntryId),
    pricingType: optionalString(raw.pricingType),
    packageName: optionalString(raw.packageName),
    unitPrice: optionalNumber(raw.unitPrice),
  });
  const clientPrice = optionalNumber(raw.unitPrice);
  if (!entry || (clientPrice !== undefined && clientPrice !== entry.price)) {
    throw new LineConflict(index, `The price of ${product.name} has changed. Please add it to your cart again.`);
  }

  let width: number | undefined;
  let height: number | undefined;
  if (isAreaPriced(entry)) {
    width = optionalNumber(raw.width);
    height = optionalNumber(raw.height);
    if (!width || !height || width <= 0 || height <= 0 || width > MAX_DIMENSION_FT || height > MAX_DIMENSION_FT) {
      throw new LineConflict(index, `Enter the size for ${product.name} again.`);
    }
  }

  const pricing = {
    pricingType: entry.pricingType,
    pricingEntryId: entry.id,
    unitPrice: entry.price,
    unit: entry.unit,
    width,
    height,
    packageName: entry.packageName,
    ...(width && height ? { size: { width, height, unit: 'ft' } } : {}),
  };
  // Whole centavos: size-priced lines can come out fractional (1.15 × 2.30 ft × ₱15 = ₱39.675), and
  // PayMongo charges whole centavos — rounding here keeps the order, the payment page and the amount
  // paid in agreement.
  return { ...base, pricing, lineTotal: roundToCentavo(computeLineTotal(pricing, quantity)) };
}

router.post('/', placeOrderLimiter, async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as Body;

    // Honeypot: a hidden field real buyers never fill in.
    if (typeof body.website === 'string' && body.website.trim()) {
      res.status(400).json({ error: 'Could not place the order.' });
      return;
    }

    const name = text(body.customer?.name, 60);
    const phone = typeof body.customer?.phone === 'string' ? body.customer.phone.trim() : '';
    const street = text(body.address?.street, 120);
    const barangay = text(body.address?.barangay, 60);
    const city = text(body.address?.city, 60);
    const province = typeof body.address?.province === 'string' ? body.address.province.trim() : '';
    const zip = typeof body.address?.zip === 'string' ? body.address.zip.trim() : '';
    const region = regionOfProvince(province);

    const fieldError =
      (!name && 'Enter your full name (up to 60 characters).') ||
      (!isValidPhMobileNumber(phone) && 'Enter a valid PH mobile number, e.g. 0917 123 4567.') ||
      (!street && 'Enter your house number and street.') ||
      (!barangay && 'Enter your barangay.') ||
      (!city && 'Enter your city or municipality.') ||
      (!region && 'Choose your province.') ||
      (zip && !/^\d{4}$/.test(zip) && 'ZIP code must be 4 digits.') ||
      null;
    if (fieldError) {
      res.status(400).json({ error: fieldError });
      return;
    }

    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
      res.status(400).json({ error: `Your cart must have between 1 and ${MAX_ITEMS} items.` });
      return;
    }

    let items: OrderItemInput[];
    const productImages = new Map<string, string>();
    try {
      items = await Promise.all(
        (body.items as LineInput[]).map((line, index) => resolveLine(line ?? {}, index, productImages))
      );
    } catch (err) {
      if (err instanceof LineConflict) {
        res.status(409).json({ error: err.message, itemIndex: err.itemIndex });
        return;
      }
      throw err;
    }

    const { shippingRates } = await getSettings();
    const shippingFee = shippingRates[region!];
    const subtotal = items.reduce((sum, item) => sum + (item.lineTotal ?? 0), 0);
    const total = roundToCentavo(subtotal + shippingFee);
    // One line for the single address column, e.g. "12 Rizal St, Brgy. San Isidro, Quezon City, Metro Manila 1100".
    const barangayLabel = /^(brgy\.?|barangay)\s/i.test(barangay!) ? barangay : `Brgy. ${barangay}`;
    const address = `${street}, ${barangayLabel}, ${city}, ${province}${zip ? ` ${zip}` : ''}`.slice(0, 250);

    const orderInput: OrderInput = {
      customerName: name!,
      customerPhone: phone,
      items,
      subtotal,
      discount: 0,
      total,
      notes: '',
      channel: SHOP_ORDER_CHANNEL,
      shippingAddress: { name: name!, phone, address, fee: shippingFee },
      payment: { status: 'unpaid', method: null, downPayment: 0, balance: total },
    };

    // A "price on request" line means the total isn't final, so there's nothing to charge yet:
    // place the order unpaid and staff quote + collect payment, as before online payments.
    if (items.some((item) => item.pricing?.pricingType === 'Manual')) {
      const order = await createOrder(orderInput, null);
      res.status(201).json({ kind: 'order', orderNumber: order.orderNumber, total: order.total });
      return;
    }

    // Otherwise the buyer pays first; the order is only created once PayMongo confirms it.
    if (!PAYMONGO_SECRET_KEY || !SHOP_URL) {
      console.error('Shop checkout: PAYMONGO_SECRET_KEY and SHOP_URL must be set to take online payments.');
      res.status(502).json({ error: 'Online payment is unavailable right now. Please try again in a moment.' });
      return;
    }
    const order = buildOrder(orderInput, null);
    const checkoutId = randomUUID();
    await createShopCheckout(checkoutId, toRpcPayload(order), total);
    let session;
    try {
      session = await createCheckoutSession({
        lineItems: [
          ...order.items.map((item) => {
            const imageUrl = productImages.get(item.productId);
            return {
              name: `${item.productName}${item.quantity > 1 ? ` ×${item.quantity}` : ''}`,
              description: lineDescription(item),
              images: imageUrl ? [imageUrl] : undefined,
              amount: item.lineTotal,
              quantity: 1,
            };
          }),
          // PayMongo won't take a ₱0 line, so free shipping simply has no row.
          ...(shippingFee > 0
            ? [
                {
                  name: 'Shipping fee',
                  description: `Delivery to ${city}, ${province} · ${REGION_LABELS[region!]} rate`,
                  images: [SHIPPING_IMAGE_URL],
                  amount: shippingFee,
                  quantity: 1,
                },
              ]
            : []),
        ],
        total,
        referenceNumber: checkoutId,
        description: 'DG Prints online order',
        successUrl: `${SHOP_URL}/checkout/return?id=${checkoutId}`,
        cancelUrl: `${SHOP_URL}/checkout?payment=cancelled`,
        billing: { name: name!, phone },
        metadata: { checkoutId },
      });
    } catch (err) {
      console.error(err);
      await expireShopCheckout(checkoutId);
      res.status(502).json({ error: 'Online payment is unavailable right now. Please try again in a moment.' });
      return;
    }
    await attachCheckoutSession(checkoutId, session.id, session.checkoutUrl);

    res.status(201).json({ kind: 'payment', checkoutId, checkoutUrl: session.checkoutUrl });
  } catch (err) {
    next(err);
  }
});

export default router;
