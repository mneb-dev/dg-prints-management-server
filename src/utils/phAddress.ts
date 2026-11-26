import type { ShippingAddress, ShippingAddressParts } from '../types/order.js';
import { normalizePhone } from './phPhone.js';
import { canonicalProvinceName } from './phProvinces.js';

export const ADDRESS_MAX = 250;
export const ADDRESS_DETAIL_MAX = 150;
export const ADDRESS_PLACE_MAX = 60;

/**
 * One line for the single address column, e.g.
 * "12 Rizal St, Brgy. San Isidro, Quezon City, Metro Manila 1100". Shared by the portal order form
 * (structured parts) and the online shop checkout, and the shape SPX's "Paste & Autofill" reads best.
 */
export function composeAddress(parts: Omit<ShippingAddressParts, 'zip'> & { zip?: string }): string {
  const barangay = parts.barangay.trim();
  const barangayLabel = /^(brgy\.?|barangay)\s/i.test(barangay) ? barangay : `Brgy. ${barangay}`;
  const zip = parts.zip?.trim();
  return `${parts.detail.trim()}, ${barangayLabel}, ${parts.city.trim()}, ${parts.province.trim()}${zip ? ` ${zip}` : ''}`;
}

function isString(value: unknown, max: number, required: boolean): value is string {
  return typeof value === 'string' && value.trim().length <= max && (!required || !!value.trim());
}

/** Validates `shippingAddress.parts` (optional — absent on legacy free-text addresses). */
export function validateShippingParts(parts: unknown): string | null {
  if (parts === undefined || parts === null) return null;
  if (typeof parts !== 'object') return '"shippingAddress.parts" must be an object';
  const { detail, barangay, city, province, zip } = parts as Record<string, unknown>;
  if (!isString(detail, ADDRESS_DETAIL_MAX, true)) {
    return `"shippingAddress.parts.detail" is required (at most ${ADDRESS_DETAIL_MAX} characters)`;
  }
  if (!isString(barangay, ADDRESS_PLACE_MAX, true)) {
    return `"shippingAddress.parts.barangay" is required (at most ${ADDRESS_PLACE_MAX} characters)`;
  }
  if (!isString(city, ADDRESS_PLACE_MAX, true)) {
    return `"shippingAddress.parts.city" is required (at most ${ADDRESS_PLACE_MAX} characters)`;
  }
  if (typeof province !== 'string' || !canonicalProvinceName(province)) {
    return '"shippingAddress.parts.province" must be a Philippine province';
  }
  if (zip !== undefined && zip !== null && zip !== '' && (typeof zip !== 'string' || !/^\d{4}$/.test(zip.trim()))) {
    return '"shippingAddress.parts.zip" must be 4 digits';
  }
  const composed = composeAddress({ detail, barangay, city, province, zip: typeof zip === 'string' ? zip : '' });
  if (composed.length > ADDRESS_MAX) {
    return `The full address must be at most ${ADDRESS_MAX} characters — shorten the detail address`;
  }
  return null;
}

/**
 * The shipping address as stored: only known fields, and — when structured parts are sent — trimmed parts
 * with `address` recomposed from them, so the one-line address can't drift from the parts.
 * Call after `validateShippingAddress` has passed.
 */
export function normalizeShippingAddress(raw: unknown): ShippingAddress | null | undefined {
  if (raw === undefined || raw === null) return raw;
  const input = raw as Partial<Record<keyof ShippingAddress, unknown>>;
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const phone = typeof input.phone === 'string' ? normalizePhone(input.phone.trim()) : '';
  const fee = Number(input.fee);
  const base = { name, phone, fee: Number.isFinite(fee) && fee > 0 ? fee : 0 };

  const rawParts = input.parts as Partial<Record<keyof ShippingAddressParts, unknown>> | null | undefined;
  if (!rawParts) {
    return { ...base, address: typeof input.address === 'string' ? input.address.trim() : '' };
  }
  const parts: ShippingAddressParts = {
    detail: String(rawParts.detail).trim(),
    barangay: String(rawParts.barangay).trim(),
    city: String(rawParts.city).trim(),
    province: canonicalProvinceName(String(rawParts.province))!,
    zip: typeof rawParts.zip === 'string' ? rawParts.zip.trim() : '',
  };
  return { ...base, address: composeAddress(parts), parts };
}
