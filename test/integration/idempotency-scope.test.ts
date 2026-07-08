import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql from '../../src/db/client.js';
import { request } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Idempotency key is scoped per route', () => {
  test('same key on different endpoints does not replay across routes', async () => {
    const headers = { 'Idempotency-Key': 'cross-endpoint-key' };

    const res1 = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Scope User', initial_balance_cents: 1_000 },
      headers,
    });
    expect(res1.status).toBe(201);
    expect((res1.body as Record<string, unknown>).owner_name).toBe('Scope User');

    const res2 = await request(app, 'POST', '/webhooks/config', {
      body: { url: 'https://example.com/hook' },
      headers,
    });
    expect(res2.status).toBe(201);
    expect((res2.body as Record<string, unknown>).url).toBe('https://example.com/hook');
    expect((res2.body as Record<string, unknown>).owner_name).toBeUndefined();
  });

  test('same key on the same route still replays the cached response', async () => {
    const headers = { 'Idempotency-Key': 'same-route-key' };

    const res1 = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Replay User', initial_balance_cents: 2_000 },
      headers,
    });
    const res2 = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Different Name', initial_balance_cents: 9_999 },
      headers,
    });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect((res2.body as Record<string, unknown>).id).toBe((res1.body as Record<string, unknown>).id);
    expect((res2.body as Record<string, unknown>).owner_name).toBe('Replay User');
  });

  test('same key on the same route but different resource ids does not cross-replay', async () => {
    const headers = { 'Idempotency-Key': 'per-resource-key' };

    const accountRes = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Capture User', initial_balance_cents: 100_000 },
    });
    const accountId = (accountRes.body as Record<string, unknown>).id as string;

    const authA = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
    });
    const authB = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 2_000 },
    });
    const idA = (authA.body as Record<string, unknown>).id as string;
    const idB = (authB.body as Record<string, unknown>).id as string;

    const capA = await request(app, 'POST', `/payments/${idA}/capture`, { headers });
    const capB = await request(app, 'POST', `/payments/${idB}/capture`, { headers });

    expect(capA.status).toBe(200);
    expect(capB.status).toBe(200);
    expect((capA.body as Record<string, unknown>).id).toBe(idA);
    expect((capB.body as Record<string, unknown>).id).toBe(idB);
  });
});
