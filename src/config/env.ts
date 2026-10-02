import { fileURLToPath } from 'node:url';
import path from 'node:path';

import dotenv from 'dotenv';

export const NODE_ENV = process.env.NODE_ENV || 'development';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const envFile = NODE_ENV === 'production' ? '.env.production' : '.env.development';

dotenv.config({ path: path.resolve(projectRoot, envFile) });

export const PORT = Number(process.env.PORT) || 3000;

export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

/** Comma-separated list of allowed origins (e.g. the staff portal and the online shop).
 *  Empty means allow any origin. */
export const CORS_ORIGINS = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME ?? '';
export const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';

export const CUSTOMER_RANKING_WINDOW_DAYS = Number(process.env.CUSTOMER_RANKING_WINDOW_DAYS) || 30;

export const CRON_SECRET = process.env.CRON_SECRET ?? '';

/** Online shop payments (PayMongo Checkout Sessions). Test keys on dev, live keys on prod. */
export const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY ?? '';
/** The `secret_key` PayMongo returned when this environment's webhook was registered. */
export const PAYMONGO_WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET ?? '';
/** Comma-separated PayMongo payment_method_types; only list methods enabled on the account. */
export const PAYMONGO_PAYMENT_METHODS = (process.env.PAYMONGO_PAYMENT_METHODS || 'gcash,paymaya')
  .split(',')
  .map((method) => method.trim())
  .filter(Boolean);
/** Public online shop URL (no trailing slash) — PayMongo sends buyers back here after paying. */
export const SHOP_URL = (process.env.SHOP_URL ?? '').replace(/\/+$/, '');

// Not fatal (the portal API must keep working), but without these the shop can't take payments:
// fully-priced checkouts fail and PayMongo webhooks are rejected. Shows up in the Vercel logs.
if (NODE_ENV === 'production') {
  const missing = [
    !PAYMONGO_SECRET_KEY && 'PAYMONGO_SECRET_KEY',
    !PAYMONGO_WEBHOOK_SECRET && 'PAYMONGO_WEBHOOK_SECRET',
    !SHOP_URL.startsWith('https://') && 'SHOP_URL (https)',
  ].filter(Boolean);
  if (missing.length > 0) {
    console.error(`[config] Online shop payments are not configured — missing: ${missing.join(', ')}`);
  }
}

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
