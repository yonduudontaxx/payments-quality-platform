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

describe('Schema validation — POST /accounts', () => {
  test('missing owner_name returns 400', async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { initial_balance_cents: 1000 },
    });
    expect(res.status).toBe(400);
  });

  test('missing initial_balance_cents returns 400', async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Test User' },
    });
    expect(res.status).toBe(400);
  });

  test('empty owner_name (minLength violation) returns 400', async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: '', initial_balance_cents: 1000 },
    });
    expect(res.status).toBe(400);
  });

  test('negative initial_balance_cents returns 400', async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Test', initial_balance_cents: -1 },
    });
    expect(res.status).toBe(400);
  });

  test('non-integer initial_balance_cents returns 400', async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Test', initial_balance_cents: 'fifty' },
    });
    expect(res.status).toBe(400);
  });

  test('currency longer than 3 chars returns 400', async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Test', initial_balance_cents: 1000, currency: 'USDX' },
    });
    expect(res.status).toBe(400);
  });

});

describe('Schema validation — POST /payments/authorize', () => {
  let accountId: string;

  beforeAll(async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Validation Test User', initial_balance_cents: 100_000 },
    });
    accountId = ((res.body as Record<string, unknown>).id) as string;
  });

  test('missing account_id returns 400', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { amount_cents: 1000 },
    });
    expect(res.status).toBe(400);
  });

  test('missing amount_cents returns 400', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId },
    });
    expect(res.status).toBe(400);
  });

  test('amount_cents of 0 returns 400 (minimum is 1)', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 0 },
    });
    expect(res.status).toBe(400);
  });

  test('negative amount_cents returns 400', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: -100 },
    });
    expect(res.status).toBe(400);
  });

  test('non-UUID account_id returns 400', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: 'not-a-uuid', amount_cents: 1000 },
    });
    expect(res.status).toBe(400);
  });

});

describe('Schema validation — POST /simulate/config', () => {
  test('timeout_ms below 0 returns 400', async () => {
    const res = await request(app, 'POST', '/simulate/config', {
      body: { timeout_ms: -1 },
    });
    expect(res.status).toBe(400);
  });

  test('timeout_ms above 30000 returns 400', async () => {
    const res = await request(app, 'POST', '/simulate/config', {
      body: { timeout_ms: 30001 },
    });
    expect(res.status).toBe(400);
  });

  test('decline_rate below 0 returns 400', async () => {
    const res = await request(app, 'POST', '/simulate/config', {
      body: { decline_rate: -0.1 },
    });
    expect(res.status).toBe(400);
  });

  test('decline_rate above 1 returns 400', async () => {
    const res = await request(app, 'POST', '/simulate/config', {
      body: { decline_rate: 1.1 },
    });
    expect(res.status).toBe(400);
  });

});

describe('Schema validation — GET /payments/:id', () => {
  test('non-UUID id returns 400', async () => {
    const res = await request(app, 'GET', '/payments/not-a-uuid');
    expect(res.status).toBe(400);
  });
});
