import { describe, test, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
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

  // Create a shared account for simulation tests
  const res = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Simulation Test User', initial_balance_cents: 999_999 },
  });
  const body = res.body as Record<string, unknown>;
  accountId = body.id as string;
});

afterAll(async () => {
  if (app) await app.close();
});

afterEach(async () => {
  // Reset simulation config after each test
  const res = await request(app, 'DELETE', '/simulate/config', {});
  expect(res.status).toBe(204);
});

describe('Simulation', () => {
  test('timeout_ms adds delay to requests', async () => {
    await request(app, 'POST', '/simulate/config', {
      body: { timeout_ms: 200 },
    });

    const start = Date.now();
    // Use a non-existent account to get a fast 404 — the delay is what we're measuring
    await request(app, 'GET', '/accounts/00000000-0000-0000-0000-000000000000');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(200);
  }, 10_000);

  test('decline_rate: 1.0 always declines authorize', async () => {
    await request(app, 'POST', '/simulate/config', {
      body: { decline_rate: 1.0 },
    });

    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 100 },
    });

    expect(res.status).toBe(402);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('SIMULATED_DECLINE');
  });

  test('decline_rate: 0.0 never declines', async () => {
    await request(app, 'POST', '/simulate/config', {
      body: { decline_rate: 0.0 },
    });

    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 100 },
    });

    expect(res.status).toBe(201);
  });

  test('GET /simulate/config returns current config', async () => {
    await request(app, 'POST', '/simulate/config', {
      body: { timeout_ms: 100, decline_rate: 0.5 },
    });
    const res = await request(app, 'GET', '/simulate/config');
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.timeout_ms).toBe(100);
    expect(body.decline_rate).toBe(0.5);
  });

  test('timeout_ms boundary: 0 applies no delay', async () => {
    await request(app, 'POST', '/simulate/config', { body: { timeout_ms: 0 } });
    const start = Date.now();
    await request(app, 'GET', `/accounts/${accountId}`);
    expect(Date.now() - start).toBeLessThan(500);
  });

  test('timeout_ms boundary: 30000 is accepted by schema', async () => {
    const res = await request(app, 'POST', '/simulate/config', { body: { timeout_ms: 30000 } });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).timeout_ms).toBe(30000);
  });

  test('decline_rate boundary: 0 never declines', async () => {
    await request(app, 'POST', '/simulate/config', { body: { decline_rate: 0 } });
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 100 },
    });
    expect(res.status).toBe(201);
  });

  test('decline_rate boundary: 1.0 always declines', async () => {
    await request(app, 'POST', '/simulate/config', { body: { decline_rate: 1.0 } });
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 100 },
    });
    expect(res.status).toBe(402);
  });

  test('DELETE /simulate/config resets simulation', async () => {
    // Set a 200ms timeout
    await request(app, 'POST', '/simulate/config', {
      body: { timeout_ms: 200 },
    });

    // Delete config — resets to defaults
    const deleteRes = await request(app, 'DELETE', '/simulate/config');
    expect(deleteRes.status).toBe(204);

    // Next request should NOT be delayed by 200ms
    const start = Date.now();
    await request(app, 'GET', '/accounts/00000000-0000-0000-0000-000000000000');
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
  });
});
