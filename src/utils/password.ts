import { randomInt } from 'node:crypto';

export const PASSWORD_MIN_LENGTH = 8;

export const PASSWORD_REQUIREMENTS_MESSAGE =
  'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character.';

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SPECIAL = '!@#$%^&*-_=+?';
const ALL = LOWERCASE + UPPERCASE + DIGITS + SPECIAL;

function randomChar(charset: string): string {
  return charset[randomInt(charset.length)];
}

function shuffle(chars: string[]): string[] {
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars;
}

/** Generates a random password guaranteed to satisfy isStrongPassword. */
export function generateStrongPassword(length = 12): string {
  const required = [randomChar(LOWERCASE), randomChar(UPPERCASE), randomChar(DIGITS), randomChar(SPECIAL)];
  const rest = Array.from({ length: Math.max(length - required.length, 0) }, () => randomChar(ALL));
  return shuffle([...required, ...rest]).join('');
}
