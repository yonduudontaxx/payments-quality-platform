import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql, { toJson } from '../../src/db/client.js';
import { request } from './helpers.js';

let app: FastifyInstance;
let accountId: string;

beforeAll(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  app = await buildApp();
  await app.ready();

  // Create a shared account for idempotency tests
  const res = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Idempotency Test User', initial_balance_cents: 500_000 },
  });
  const body = res.body as Record<string, unknown>;
  accountId = body.id as string;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Idempotency', () => {
  test('same Idempotency-Key returns cached response', async () => {
    const key = 'test-key-1';

    const res1 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
      headers: { 'Idempotency-Key': key },
    });

    const res2 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
      headers: { 'Idempotency-Key': key },
    });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = res1.body as Record<string, unknown>;
    const body2 = res2.body as Record<string, unknown>;
    // Entire response must be identical, not just the id
    expect(body2.id).toBe(body1.id);
    expect(body2.status).toBe(body1.status);
    expect(body2.amount_cents).toBe(body1.amount_cents);
  });

  test('cached response is returned even when request body differs', async () => {
    const key = 'test-key-reuse';

    const res1 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
      headers: { 'Idempotency-Key': key },
    });

    // Different amount — should still return the cached first response
    const res2 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 9_999 },
      headers: { 'Idempotency-Key': key },
    });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    const body1 = res1.body as Record<string, unknown>;
    const body2 = res2.body as Record<string, unknown>;
    expect(body2.id).toBe(body1.id);
    expect(body2.amount_cents).toBe(1_000); // cached value, not 9_999
  });

  test('different keys create different transactions', async () => {
    const res1 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
      headers: { 'Idempotency-Key': 'key-A' },
    });

    const res2 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
      headers: { 'Idempotency-Key': 'key-B' },
    });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = res1.body as Record<string, unknown>;
    const body2 = res2.body as Record<string, unknown>;
    expect(body1.id).not.toBe(body2.id);
  });

  test('missing Idempotency-Key creates new transaction each time', async () => {
    const res1 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
    });

    const res2 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
    });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const body1 = res1.body as Record<string, unknown>;
    const body2 = res2.body as Record<string, unknown>;
    expect(body1.id).not.toBe(body2.id);
  });

  test('expired cache entry (>24h) is not returned — new transaction is created', async () => {
    const key = 'test-key-expired';

    // Seed an expired entry directly in the DB
    await sql`
      INSERT INTO idempotency_cache (key, status_code, body, created_at)
      VALUES (
        ${key},
        201,
        ${sql.json(toJson({ id: 'old-expired-id', status: 'authorized', amount_cents: 1000 }))},
        now() - interval '25 hours'
      )
    `;

    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
      headers: { 'Idempotency-Key': key },
    });

    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    // Should have created a new transaction, not returned the expired cached one
    expect(body.id).not.toBe('old-expired-id');
  });

  test('concurrent requests with same key both return 201', async () => {
    const key = 'test-key-concurrent';

    const [res1, res2] = await Promise.all([
      request(app, 'POST', '/payments/authorize', {
        body: { account_id: accountId, amount_cents: 1_000 },
        headers: { 'Idempotency-Key': key },
      }),
      request(app, 'POST', '/payments/authorize', {
        body: { account_id: accountId, amount_cents: 1_000 },
        headers: { 'Idempotency-Key': key },
      }),
    ]);

    // Both requests must succeed regardless of race
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    // A subsequent request with the same key must return a cached response
    const res3 = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
      headers: { 'Idempotency-Key': key },
    });
    expect(res3.status).toBe(201);
    // res3 must match one of the first two (whichever was cached)
    const ids = new Set([
      (res1.body as Record<string, unknown>).id,
      (res2.body as Record<string, unknown>).id,
    ]);
    expect(ids.has((res3.body as Record<string, unknown>).id as string)).toBe(true);
  });
});
