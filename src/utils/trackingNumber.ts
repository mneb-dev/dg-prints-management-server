// SPX tracking numbers look like "SPEPH06200552895B". We only check the shape loosely (letters, digits and
// dashes, at most 40), so other couriers' numbers still fit if staff ever use one.

export const TRACKING_NUMBER_MAX_LENGTH = 40;

/** Trimmed + uppercased; '' / null → null. `error` when it isn't a plausible tracking number. */
export function normalizeTrackingNumber(value: unknown): { value: string | null; error?: string } {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== 'string') return { value: null, error: '"trackingNumber" must be a string' };
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) return { value: null };
  if (trimmed.length > TRACKING_NUMBER_MAX_LENGTH) {
    return { value: null, error: `Tracking number must be at most ${TRACKING_NUMBER_MAX_LENGTH} characters` };
  }
  if (!/^[A-Z0-9-]+$/.test(trimmed)) {
    return { value: null, error: 'Tracking number can only have letters, numbers and dashes' };
  }
  return { value: trimmed };
}
