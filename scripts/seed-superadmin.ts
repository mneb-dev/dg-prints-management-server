import { randomUUID } from 'node:crypto';

import bcrypt from 'bcryptjs';

import { SUPERADMIN_PASSWORD, SUPERADMIN_USERNAME } from '../src/config/env.js';
import { supabase } from '../src/config/supabaseClient.js';

async function main() {
  if (!SUPERADMIN_USERNAME || !SUPERADMIN_PASSWORD) {
    throw new Error('SUPERADMIN_USERNAME and SUPERADMIN_PASSWORD must be set in .env');
  }

  const { data: existing, error: selectError } = await supabase
    .from('users')
    .select('id, username')
    .eq('role', 'superadmin')
    .limit(1)
    .maybeSingle();
  if (selectError) throw new Error(selectError.message);

  if (existing) {
    console.log(`A superadmin already exists (username: "${existing.username}"). Skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10);
  const { error: insertError } = await supabase.from('users').insert({
    id: randomUUID(),
    first_name: 'Super',
    last_name: 'Admin',
    username: SUPERADMIN_USERNAME,
    password_hash: passwordHash,
    role: 'superadmin',
    permissions: ['manage_products', 'manage_orders', 'manage_users', 'view_reports'],
  });
  if (insertError) throw new Error(insertError.message);

  console.log(`Superadmin account created: username "${SUPERADMIN_USERNAME}".`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
