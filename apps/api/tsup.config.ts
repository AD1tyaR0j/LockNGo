import { defineConfig } from 'tsup';

// Seed is dev-only and runs via tsx; it is intentionally not part of the production build.
export default defineConfig({
  entry: { server: 'src/server.ts', migrate: 'src/db/migrate.ts' },
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: ['@sl/shared'],
});
