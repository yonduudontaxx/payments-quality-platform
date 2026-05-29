import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import sql from './client.js';

async function migrate(): Promise<void> {
  const migrationsDir = join(process.cwd(), 'migrations');

  let files: string[];
  try {
    const entries = await readdir(migrationsDir);
    files = entries.filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    console.error('Failed to read migrations directory:', err);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('No migration files found.');
    await sql.end();
    process.exit(0);
  }

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    console.log(`Running migration: ${file}`);
    try {
      const sqlText = await readFile(filePath, 'utf-8');
      await sql.unsafe(sqlText);
      console.log(`  ✓ ${file} applied`);
    } catch (err) {
      console.error(`  ✗ Failed to apply ${file}:`, err);
      await sql.end();
      process.exit(1);
    }
  }

  console.log('All migrations applied successfully.');
  await sql.end();
  process.exit(0);
}

migrate();
