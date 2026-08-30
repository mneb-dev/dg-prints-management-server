import dotenv from 'dotenv';

dotenv.config();

export const PORT = Number(process.env.PORT) || 3000;
export const NODE_ENV = process.env.NODE_ENV || 'development';

export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export const JWT_SECRET = process.env.JWT_SECRET ?? '';
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

export const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME ?? '';
export const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
