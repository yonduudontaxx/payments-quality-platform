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

  const res = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Retry Decline User', initial_balance_cents: 100 },
  });
  accountId = (res.body as Record<string, unknown>).id as string;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Idempotent retry of a declined authorize', () => {
  test('retrying an insufficient-funds authorize with the same key returns 402, not 500', async () => {
    const headers = { 'Idempotency-Key': 'declined-retry-key' };
    const body = { account_id: accountId, amount_cents: 1_000 };

    const res1 = await request(app, 'POST', '/payments/authorize', { body, headers });
    expect(res1.status).toBe(402);
    expect((res1.body as Record<string, unknown>).error).toBe('INSUFFICIENT_FUNDS');

    const res2 = await request(app, 'POST', '/payments/authorize', { body, headers });
    expect(res2.status).toBe(402);
    expect((res2.body as Record<string, unknown>).error).toBe('INSUFFICIENT_FUNDS');

    const rows = await sql<{ idempotency_key: string | null }[]>`
      SELECT idempotency_key FROM transactions
      WHERE account_id = ${accountId} AND status = 'failed'
    `;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.idempotency_key === null)).toBe(true);
  });
});
