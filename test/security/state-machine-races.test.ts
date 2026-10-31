import { describe, test, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql from '../../src/db/client.js';
import { request } from '../integration/helpers.js';

const PARALLEL = 8;
const STARTING_BALANCE = 50_000;
const AMOUNT = 5_000;

let app: FastifyInstance;
let accountId: string;

async function balance(): Promise<number> {
  const res = await request(app, 'GET', `/accounts/${accountId}`);
  return (res.body as Record<string, number>).balance_cents;
}

async function authorize(): Promise<string> {
  const res = await request(app, 'POST', '/payments/authorize', {
    body: { account_id: accountId, amount_cents: AMOUNT },
  });
  return (res.body as Record<string, unknown>).id as string;
}

function fire(path: string, withDistinctKeys = false) {
  return Promise.all(Array.from({ length: PARALLEL }, (_, i) =>
    request(app, 'POST', path, withDistinctKeys ? { headers: { 'Idempotency-Key': `race-${path}-${i}` } } : {}),
  ));
}

function tally(responses: Array<{ status: number; body: unknown }>) {
  return {
    ok: responses.filter((r) => r.status === 200).length,
    conflicts: responses.filter((r) => r.status === 422
      && (r.body as Record<string, unknown>).error === 'INVALID_STATE_TRANSITION').length,
    other: responses.filter((r) => r.status !== 200 && r.status !== 422).map((r) => r.status),
  };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

beforeEach(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  const res = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Race User', initial_balance_cents: STARTING_BALANCE },
  });
  accountId = (res.body as Record<string, unknown>).id as string;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Concurrent state transitions', () => {
  test(`${PARALLEL} concurrent captures of one authorization: exactly one succeeds`, async () => {
    const id = await authorize();
    const result = tally(await fire(`/payments/${id}/capture`));

    expect(result).toEqual({ ok: 1, conflicts: PARALLEL - 1, other: [] });
    const tx = await request(app, 'GET', `/payments/${id}`);
    expect((tx.body as Record<string, unknown>).status).toBe('captured');
  });

  test(`${PARALLEL} concurrent refunds of one capture: exactly one succeeds and the balance is credited once`, async () => {
    const id = await authorize();
    await request(app, 'POST', `/payments/${id}/capture`);
    expect(await balance()).toBe(STARTING_BALANCE - AMOUNT);

    const result = tally(await fire(`/payments/${id}/refund`));

    expect(result).toEqual({ ok: 1, conflicts: PARALLEL - 1, other: [] });
    expect(await balance()).toBe(STARTING_BALANCE);
  });

  test('distinct idempotency keys do not let concurrent refunds bypass the state machine', async () => {
    const id = await authorize();
    await request(app, 'POST', `/payments/${id}/capture`);

    const result = tally(await fire(`/payments/${id}/refund`, true));

    expect(result).toEqual({ ok: 1, conflicts: PARALLEL - 1, other: [] });
    expect(await balance()).toBe(STARTING_BALANCE);
  });

  test('concurrent capture and refund race never refunds an uncaptured payment', async () => {
    const id = await authorize();
    const responses = await Promise.all([
      request(app, 'POST', `/payments/${id}/refund`),
      request(app, 'POST', `/payments/${id}/capture`),
      request(app, 'POST', `/payments/${id}/refund`),
    ]);

    expect(responses.every((r) => r.status === 200 || r.status === 422)).toBe(true);
    const tx = await request(app, 'GET', `/payments/${id}`);
    const status = (tx.body as Record<string, unknown>).status;
    const expectedBalance = status === 'refunded' ? STARTING_BALANCE : STARTING_BALANCE - AMOUNT;
    expect(['captured', 'refunded']).toContain(status);
    expect(await balance()).toBe(expectedBalance);
  });

  test('concurrent authorizations cannot overdraw the account', async () => {
    const responses = await Promise.all(Array.from({ length: PARALLEL * 2 }, () =>
      request(app, 'POST', '/payments/authorize', { body: { account_id: accountId, amount_cents: AMOUNT } }),
    ));

    const approved = responses.filter((r) => r.status === 201).length;
    expect(approved).toBe(STARTING_BALANCE / AMOUNT);
    expect(responses.filter((r) => r.status === 402)).toHaveLength(PARALLEL * 2 - approved);
    expect(await balance()).toBe(0);
  });
});
