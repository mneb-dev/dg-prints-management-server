const PH_MOBILE_PHONE_REGEX = /^(?:\+63|63|0)9\d{9}$/;

/** PH mobile number: 09XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX (spaces/dashes ignored). */
export function isValidPhMobileNumber(value: string): boolean {
  return PH_MOBILE_PHONE_REGEX.test(value.replace(/[\s-]/g, ''));
}
