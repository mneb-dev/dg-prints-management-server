import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../supabase/migrations');

const TABLES_TO_CHECK = ['products', 'orders', 'users'];

function parseArgs() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const urlFlagIndex = args.indexOf('--url');
  const urlFromFlag = urlFlagIndex !== -1 ? args[urlFlagIndex + 1] : undefined;
  const databaseUrl = urlFromFlag ?? process.env.TARGET_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Provide the target Postgres connection string via --url "postgres://..." or the TARGET_DATABASE_URL ' +
        'env var. Find it in the target Supabase project: Project Settings > Database > Connection string ' +
        '(URI). This is NOT the same as SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY used by the app.',
    );
  }
  return { databaseUrl, force };
}

function loadMigrations() {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({ name: file, sql: readFileSync(path.join(migrationsDir, file), 'utf8') }));
}

async function assertTargetIsEmpty(client: Client) {
  for (const table of TABLES_TO_CHECK) {
    const { rows } = await client.query('select to_regclass($1) as reg', [`public.${table}`]);
    if (!rows[0].reg) continue;

    const { rows: countRows } = await client.query(`select count(*)::int as count from public.${table}`);
    if (countRows[0].count > 0) {
      throw new Error(
        `Target database already has ${countRows[0].count} row(s) in "${table}". Refusing to run against a ` +
          'database that has real data, to avoid mixing partial schema state into it. Re-run with --force to ' +
          'override (existing objects are left untouched; migrations use "create table if not exists").',
      );
    }
  }
}

async function main() {
  const { databaseUrl, force } = parseArgs();
  const migrations = loadMigrations();
  if (migrations.length === 0) throw new Error(`No .sql files found in ${migrationsDir}`);

  const targetHost = new URL(databaseUrl).host;
  console.log(`Target: ${targetHost}`);

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    if (!force) await assertTargetIsEmpty(client);

    console.log(`Applying ${migrations.length} migration(s) (schema only, no data)...`);
    await client.query('begin');
    for (const { name, sql } of migrations) {
      console.log(`  -> ${name}`);
      await client.query(sql);
    }
    await client.query('commit');
    console.log('Done. Schema cloned, no rows copied.');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
