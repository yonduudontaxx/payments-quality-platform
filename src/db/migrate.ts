import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import sql from './client.js';

async function migrate(): Promise<void> {
  const migrationsDir = join(process.cwd(), 'migrations');

  // Ensure tracking table exists
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT now()
  )`;

  // Get already-applied migrations
  const applied = await sql<{ filename: string }[]>`SELECT filename FROM schema_migrations`;
  const appliedSet = new Set(applied.map(r => r.filename));

  let files: string[];
  try {
    const entries = await readdir(migrationsDir);
    files = entries.filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    console.error('Failed to read migrations directory:', err);
    await sql.end();
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('No migration files found.');
    await sql.end();
    process.exit(0);
  }

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`Skipping already-applied migration: ${file}`);
      continue;
    }
    console.log(`Applying migration: ${file}`);
    try {
      const sqlContent = await readFile(join(migrationsDir, file), 'utf-8');
      await sql.unsafe(sqlContent);
      await sql`INSERT INTO schema_migrations(filename) VALUES (${file})`;
      console.log(`Applied: ${file}`);
    } catch (err) {
      console.error(`Failed to apply ${file}:`, err);
      await sql.end();
      process.exit(1);
    }
  }

  console.log('All migrations applied successfully.');
  await sql.end();
  process.exit(0);
}

migrate();
