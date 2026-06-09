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

describe('Payment API — happy path', () => {
  let accountId: string;
  let transactionId: string;

  // Set up a shared account for the lifecycle tests so no single test owns
  // the accountId/transactionId — setup failures are clearly attributed to beforeAll
  beforeAll(async () => {
    const accountRes = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Happy Path User', initial_balance_cents: 100_000, currency: 'USD' },
    });
    expect(accountRes.status).toBe(201);
    accountId = ((accountRes.body as Record<string, unknown>).id) as string;
  });

  test('POST /accounts creates account', async () => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Account Test User', initial_balance_cents: 50_000, currency: 'USD' },
    });
    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.owner_name).toBe('Account Test User');
    expect(body.balance_cents).toBe(50_000);
    expect(body.currency).toBe('USD');
    expect(typeof body.created_at).toBe('string');
    // ISO 8601 format
    expect(() => new Date(body.created_at as string).toISOString()).not.toThrow();
  });

  test('POST /payments/authorize reserves funds', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 50_000 },
      headers: { 'Idempotency-Key': 'happy-path-authorize-1' },
    });

    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.status).toBe('authorized');
    expect(body.amount_cents).toBe(50_000);

    transactionId = body.id as string;

    const accountRes = await request(app, 'GET', `/accounts/${accountId}`);
    expect(accountRes.status).toBe(200);
    expect((accountRes.body as Record<string, unknown>).balance_cents).toBe(50_000);
  });

  test('POST /payments/:id/capture settles payment', async () => {
    const res = await request(app, 'POST', `/payments/${transactionId}/capture`);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('captured');
    expect(body.id).toBe(transactionId);
  });

  test('POST /payments/:id/refund restores balance', async () => {
    const res = await request(app, 'POST', `/payments/${transactionId}/refund`);

    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.status).toBe('refunded');
    expect(body.id).toBe(transactionId);

    const accountRes = await request(app, 'GET', `/accounts/${accountId}`);
    expect(accountRes.status).toBe(200);
    expect((accountRes.body as Record<string, unknown>).balance_cents).toBe(100_000);
  });
});

describe('Payment API — error cases', () => {
  test('authorize with insufficient funds returns 402', async () => {
    const accountRes = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Broke User', initial_balance_cents: 100 },
    });
    const account = accountRes.body as Record<string, unknown>;
    const accountId = account.id as string;

    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 },
    });

    expect(res.status).toBe(402);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('INSUFFICIENT_FUNDS');
  });

  test('GET non-existent transaction returns 404', async () => {
    const res = await request(app, 'GET', '/payments/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  test('refund an authorized (not-yet-captured) transaction returns 422', async () => {
    const accountRes = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Early Refund User', initial_balance_cents: 10_000 },
    });
    const account = accountRes.body as Record<string, unknown>;

    const authRes = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: account.id, amount_cents: 1_000 },
    });
    const auth = authRes.body as Record<string, unknown>;

    const res = await request(app, 'POST', `/payments/${auth.id}/refund`);
    expect(res.status).toBe(422);
    expect((res.body as Record<string, unknown>).error).toBe('INVALID_STATE_TRANSITION');
  });

  test('capture an already-captured transaction returns 422', async () => {
    // Create a fresh account + authorize + capture
    const accountRes = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Double Capture User', initial_balance_cents: 10_000 },
    });
    const account = accountRes.body as Record<string, unknown>;

    const authRes = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: account.id, amount_cents: 1_000 },
    });
    const auth = authRes.body as Record<string, unknown>;
    const txId = auth.id as string;

    const firstCapture = await request(app, 'POST', `/payments/${txId}/capture`);
    expect(firstCapture.status).toBe(200);

    // Second capture should fail
    const res = await request(app, 'POST', `/payments/${txId}/capture`);
    expect(res.status).toBe(422);
    const body = res.body as Record<string, unknown>;
    expect(body.error).toBe('INVALID_STATE_TRANSITION');
  });
});
