import pg from 'pg';

/** Rebuilds the test database schema from migrations once per test run. */
export default async function setup() {
  await import('./setup-env.js');
  const url = process.env.DATABASE_URL!;
  if (!/_test(\?|$)/.test(new URL(url).pathname + (new URL(url).search || ''))) {
    throw new Error(`Refusing to reset a database whose name does not end in _test: ${url}`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE;');
  await client.end();

  const { runMigrations } = await import('../src/db/migrate.js');
  const { getDb, closeDb } = await import('../src/db/client.js');
  const { pricingRules } = await import('../src/db/schema.js');
  await runMigrations();
  await getDb()
    .insert(pricingRules)
    .values(
      (['S', 'M', 'L', 'XL'] as const).map((size, i) => ({
        version: 1,
        size,
        baseAmountMinor: 1000 * (i + 1),
        perHourAmountMinor: 2500,
        taxBps: 1800,
        isDemo: true,
      })),
    );
  await closeDb();
}
