import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDb, getDb } from './client.js';
import { syncRbac } from '../modules/rbac/sync.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Works from src/db (tsx) and from dist (bundled). */
export const MIGRATIONS_DIR = path.resolve(here, here.endsWith('dist') ? '../drizzle' : '../../drizzle');

export async function runMigrations(): Promise<void> {
  const db = getDb();
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  await syncRbac(db);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => {
      console.log('migrations applied and RBAC synced');
      return closeDb();
    })
    .catch(async (err) => {
      console.error(err);
      await closeDb();
      process.exit(1);
    });
}
