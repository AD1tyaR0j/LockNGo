import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config.js';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either the root db handle or an open transaction. */
export type DbOrTx = Db | Tx;

let pool: pg.Pool | undefined;
let db: Db | undefined;

export function getDb(): Db {
  if (!db) {
    pool = new pg.Pool({ connectionString: config().DATABASE_URL, max: 20 });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = undefined;
  db = undefined;
}

/** Postgres error code helper (e.g. 23505 unique_violation, 23P01 exclusion_violation). */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Constraint name from a Postgres error (searches the cause chain). */
export function pgConstraint(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const c = (e as { constraint?: unknown }).constraint;
    if (typeof c === 'string') return c;
    e = (e as { cause?: unknown }).cause;
  }
  return undefined;
}
