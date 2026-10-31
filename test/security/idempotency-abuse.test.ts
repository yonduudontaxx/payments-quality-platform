import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql from '../../src/db/client.js';
import { request } from '../integration/helpers.js';

let app: FastifyInstance;
let accountId: string;

const STARTING_BALANCE = 100_000;

async function balance(): Promise<number> {
  const res = await request(app, 'GET', `/accounts/${accountId}`);
  return (res.body as Record<string, number>).balance_cents;
}

async function transactionCount(key: string): Promise<number> {
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM transactions WHERE idempotency_key = ${key}
  `;
  return count;
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  const res = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Idempotency Abuse User', initial_balance_cents: STARTING_BALANCE },
  });
  accountId = (res.body as Record<string, unknown>).id as string;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Idempotency key abuse', () => {
  test('reusing a key with a different amount is rejected with 422 and moves no money', async () => {
    const headers = { 'Idempotency-Key': 'reuse-different-amount' };
    const first = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_000 }, headers,
    });
    const second = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 90_000 }, headers,
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(422);
    expect((second.body as Record<string, unknown>).error).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await transactionCount('reuse-different-amount')).toBe(1);
    expect(await balance()).toBe(STARTING_BALANCE - 1_000);
  });

  test('reusing a key with different metadata is rejected with 422', async () => {
    const headers = { 'Idempotency-Key': 'reuse-different-metadata' };
    await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 500, metadata: { order: 'A-1' } }, headers,
    });
    const second = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 500, metadata: { order: 'A-2' } }, headers,
    });

    expect(second.status).toBe(422);
  });

  test('a replayed rejection does not leak the original response body', async () => {
    const headers = { 'Idempotency-Key': 'reuse-no-leak' };
    const first = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 700 }, headers,
    });
    const second = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 701 }, headers,
    });

    const firstId = (first.body as Record<string, unknown>).id as string;
    expect(JSON.stringify(second.body)).not.toContain(firstId);
  });

  test('the same body with keys in a different order is a genuine retry and replays', async () => {
    const headers = { 'Idempotency-Key': 'reuse-reordered' };
    const first = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 1_200, metadata: { a: 1, b: 2 } }, headers,
    });
    const retry = await request(app, 'POST', '/payments/authorize', {
      body: { metadata: { b: 2, a: 1 }, amount_cents: 1_200, account_id: accountId }, headers,
    });

    expect(retry.status).toBe(201);
    expect((retry.body as Record<string, unknown>).id).toBe((first.body as Record<string, unknown>).id);
    expect(await balance()).toBe(STARTING_BALANCE - 1_200);
  });

  test('concurrent requests reusing one key with different bodies create exactly one transaction', async () => {
    const key = 'reuse-concurrent';
    const amounts = [1_000, 2_000, 3_000, 4_000, 5_000];
    const responses = await Promise.all(amounts.map((amount_cents) =>
      request(app, 'POST', '/payments/authorize', {
        body: { account_id: accountId, amount_cents },
        headers: { 'Idempotency-Key': key },
      }),
    ));

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 422);
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(amounts.length - 1);
    expect(await transactionCount(key)).toBe(1);

    const winner = (created[0].body as Record<string, number>).amount_cents;
    expect(await balance()).toBe(STARTING_BALANCE - winner);
  });

  test('reusing a capture key on the same transaction with a body is rejected', async () => {
    const auth = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 300 },
    });
    const id = (auth.body as Record<string, unknown>).id as string;
    const headers = { 'Idempotency-Key': 'capture-key' };

    const first = await request(app, 'POST', `/payments/${id}/capture`, { headers });
    const retry = await request(app, 'POST', `/payments/${id}/capture`, { headers });
    const tampered = await request(app, 'POST', `/payments/${id}/capture`, {
      headers, body: { amount_cents: 1 },
    });

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(tampered.status).toBe(422);
  });
});
