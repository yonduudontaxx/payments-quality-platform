import { join } from 'path';
import sql from './client.js';
import { runMigrations } from './migrator.js';

async function migrate(): Promise<void> {
  const migrationsDir = join(process.cwd(), 'migrations');
  try {
    const { applied, skipped } = await runMigrations(sql, migrationsDir);
    if (applied.length === 0 && skipped.length === 0) {
      console.log('No migration files found.');
    } else if (applied.length === 0) {
      console.log(`No pending migrations (${skipped.length} already applied).`);
    } else {
      for (const file of applied) console.log(`Applied: ${file}`);
    }
  } catch (err) {
    console.error('Migration failed:', err);
    await sql.end();
    process.exit(1);
  }
  await sql.end();
  process.exit(0);
}

migrate();
