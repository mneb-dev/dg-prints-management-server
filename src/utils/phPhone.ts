const PH_MOBILE_PHONE_REGEX = /^(?:\+63|63|0)9\d{9}$/;

/** PH mobile number: 09XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX (spaces/dashes ignored). */
export function isValidPhMobileNumber(value: string): boolean {
  return PH_MOBILE_PHONE_REGEX.test(value.replace(/[\s-]/g, ''));
}

/** Strips spaces and hyphens: "0917 123-4567" → "09171234567". Keeps a leading +63 as-is. */
export function normalizePhone(value: string): string {
  return value.replace(/[\s-]/g, '');
}
