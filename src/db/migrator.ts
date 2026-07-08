import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import sql from './client.js';

type DB = typeof sql;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(db: DB, migrationsDir: string): Promise<MigrationResult> {
  await db`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  )`;

  const alreadyApplied = await db<{ filename: string }[]>`SELECT filename FROM schema_migrations`;
  const appliedSet = new Set(alreadyApplied.map((r) => r.filename));

  const entries = await readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    if (appliedSet.has(file)) {
      skipped.push(file);
      continue;
    }
    const content = await readFile(join(migrationsDir, file), 'utf-8');
    await db.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (filename) VALUES (${file})`;
    });
    applied.push(file);
  }
  return { applied, skipped };
}
