import { describe, test, expect, beforeEach, afterAll } from '@jest/globals';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import sql from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrator.js';

async function cleanup(): Promise<void> {
  await sql`ALTER TABLE schema_migrations DROP CONSTRAINT IF EXISTS zzz_reject_tracking`;
  await sql`DROP TABLE IF EXISTS mig_probe, mig_probe_a, mig_probe_b`;
  await sql`DELETE FROM schema_migrations WHERE filename LIKE 'zzz_%'`;
}

beforeEach(cleanup);

afterAll(async () => {
  await cleanup();
});

describe('runMigrations', () => {
  test('applies a pending multi-statement migration and records it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await writeFile(
      join(dir, 'zzz_001_create.sql'),
      'CREATE TABLE mig_probe (id int);\nCREATE INDEX mig_probe_idx ON mig_probe(id);',
    );
    try {
      const { applied } = await runMigrations(sql, dir);
      expect(applied).toContain('zzz_001_create.sql');

      const [{ exists }] = await sql<{ exists: boolean }[]>`
        SELECT to_regclass('public.mig_probe') IS NOT NULL AS exists
      `;
      expect(exists).toBe(true);

      const rows = await sql`SELECT 1 FROM schema_migrations WHERE filename = 'zzz_001_create.sql'`;
      expect(rows.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('rolls back the created table when the tracking insert fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await writeFile(join(dir, 'zzz_seam.sql'), 'CREATE TABLE mig_probe (id int);');
    await sql`
      ALTER TABLE schema_migrations
      ADD CONSTRAINT zzz_reject_tracking CHECK (filename <> 'zzz_seam.sql')
    `;
    try {
      await expect(runMigrations(sql, dir)).rejects.toThrow();

      const [{ exists }] = await sql<{ exists: boolean }[]>`
        SELECT to_regclass('public.mig_probe') IS NOT NULL AS exists
      `;
      expect(exists).toBe(false);
    } finally {
      await sql`ALTER TABLE schema_migrations DROP CONSTRAINT IF EXISTS zzz_reject_tracking`;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('applies earlier migrations and rolls back only the failing one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await writeFile(join(dir, 'zzz_001_ok.sql'), 'CREATE TABLE mig_probe_a (id int);');
    await writeFile(
      join(dir, 'zzz_002_bad.sql'),
      'CREATE TABLE mig_probe_b (id int);\nINSERT INTO definitely_missing_table VALUES (1);',
    );
    try {
      await expect(runMigrations(sql, dir)).rejects.toThrow();

      const [{ a }] = await sql<{ a: boolean }[]>`SELECT to_regclass('public.mig_probe_a') IS NOT NULL AS a`;
      const [{ b }] = await sql<{ b: boolean }[]>`SELECT to_regclass('public.mig_probe_b') IS NOT NULL AS b`;
      expect(a).toBe(true);
      expect(b).toBe(false);

      const tracked = await sql<{ filename: string }[]>`
        SELECT filename FROM schema_migrations WHERE filename LIKE 'zzz_%'
      `;
      const names = tracked.map((r) => r.filename);
      expect(names).toContain('zzz_001_ok.sql');
      expect(names).not.toContain('zzz_002_bad.sql');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('skips already-applied migrations on a second run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await writeFile(join(dir, 'zzz_001_create.sql'), 'CREATE TABLE mig_probe (id int);');
    try {
      const first = await runMigrations(sql, dir);
      expect(first.applied).toContain('zzz_001_create.sql');

      const second = await runMigrations(sql, dir);
      expect(second.applied).not.toContain('zzz_001_create.sql');
      expect(second.skipped).toContain('zzz_001_create.sql');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
