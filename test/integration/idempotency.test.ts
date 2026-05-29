import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql from '../../src/db/client.js';
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
  await app.close();
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
    expect(body1.id).toBe(body2.id);
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
});
