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

export const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME ?? '';
export const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? '';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}
