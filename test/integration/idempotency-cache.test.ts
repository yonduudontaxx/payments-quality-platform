import { describe, it, expect, beforeAll, afterEach, afterAll } from '@jest/globals';
import sql, { toJson } from '../../src/db/client.js';
import { getCachedResponse, setCachedResponse } from '../../src/modules/idempotency/idempotency.service.js';

beforeAll(async () => {
  await sql`TRUNCATE idempotency_cache`;
});

afterEach(async () => {
  await sql`TRUNCATE idempotency_cache`;
});

afterAll(async () => {
  await sql.end().catch(() => {});
});

describe('Idempotency service — DB layer', () => {
  it('returns null for an unknown key', async () => {
    const result = await getCachedResponse('nonexistent-key');
    expect(result).toBeNull();
  });

  it('stores and retrieves a response', async () => {
    await setCachedResponse('key-1', 201, { id: 'abc', status: 'authorized' });
    const result = await getCachedResponse('key-1');
    expect(result).not.toBeNull();
    expect(result?.status_code).toBe(201);
    expect(result?.body).toEqual({ id: 'abc', status: 'authorized' });
  });

  it('does not overwrite an existing key (idempotent set)', async () => {
    await setCachedResponse('key-1', 201, { id: 'original' });
    await setCachedResponse('key-1', 200, { id: 'overwritten' });
    const result = await getCachedResponse('key-1');
    expect(result?.body).toEqual({ id: 'original' });
  });

  it('different keys do not interfere', async () => {
    await setCachedResponse('key-A', 201, { id: 'A' });
    await setCachedResponse('key-B', 201, { id: 'B' });
    expect((await getCachedResponse('key-A'))?.body.id).toBe('A');
    expect((await getCachedResponse('key-B'))?.body.id).toBe('B');
  });

  it('expired entries (older than 24 hours) return null', async () => {
    await sql`
      INSERT INTO idempotency_cache (key, status_code, body, created_at)
      VALUES ('expired-key', 201, ${sql.json(toJson({ id: 'old' }))}, now() - interval '25 hours')
    `;
    const result = await getCachedResponse('expired-key');
    expect(result).toBeNull();
  });

  it('non-expired entries (within 24 hours) are returned', async () => {
    await sql`
      INSERT INTO idempotency_cache (key, status_code, body, created_at)
      VALUES ('fresh-key', 201, ${sql.json(toJson({ id: 'fresh' }))}, now() - interval '23 hours')
    `;
    const result = await getCachedResponse('fresh-key');
    expect(result).not.toBeNull();
    expect(result?.body).toEqual({ id: 'fresh' });
  });
});
