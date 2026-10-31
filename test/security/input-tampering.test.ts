import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql from '../../src/db/client.js';
import { MAX_AMOUNT_CENTS } from '../../src/modules/payments/payments.schema.js';
import { MAX_BALANCE_CENTS } from '../../src/modules/accounts/accounts.schema.js';
import { request } from '../integration/helpers.js';

let app: FastifyInstance;
let accountId: string;

const STARTING_BALANCE = MAX_AMOUNT_CENTS * 2;

async function balance(): Promise<number> {
  const res = await request(app, 'GET', `/accounts/${accountId}`);
  return (res.body as Record<string, number>).balance_cents;
}

beforeAll(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  app = await buildApp();
  await app.ready();
  const res = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Tampering User', initial_balance_cents: STARTING_BALANCE },
  });
  accountId = (res.body as Record<string, unknown>).id as string;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('amount_cents tampering on POST /payments/authorize', () => {
  test.each([
    ['negative', -1],
    ['large negative', -MAX_AMOUNT_CENTS],
    ['zero', 0],
    ['fractional', 10.5],
    ['tiny fraction', 0.01],
    ['one over the maximum', MAX_AMOUNT_CENTS + 1],
    ['beyond bigint range', 1e20],
    ['beyond safe integer range', Number.MAX_SAFE_INTEGER + 2],
    ['non-numeric string', 'one hundred'],
    ['fractional string', '10.5'],
    ['null', null],
    ['array', [100]],
    ['object', { value: 100 }],
  ])('%s amount is rejected with 400 and no funds move', async (_name, amount) => {
    const before = await balance();
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: amount },
    });

    expect(res.status).toBe(400);
    expect((res.body as Record<string, unknown>).error).toBe('VALIDATION_ERROR');
    expect(await balance()).toBe(before);
  });

  test('the maximum allowed amount is accepted', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: MAX_AMOUNT_CENTS },
    });
    expect(res.status).toBe(201);
    expect((res.body as Record<string, unknown>).amount_cents).toBe(MAX_AMOUNT_CENTS);
  });

  test('unknown fields such as a client-supplied status are rejected', async () => {
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 100, status: 'captured' },
    });
    expect(res.status).toBe(400);
  });
});

describe('balance tampering on POST /accounts', () => {
  test.each([
    ['one over the maximum', MAX_BALANCE_CENTS + 1],
    ['beyond bigint range', 1e20],
    ['negative', -1],
    ['fractional', 1.5],
  ])('%s initial balance is rejected with 400', async (_name, value) => {
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: 'Overflow', initial_balance_cents: value },
    });
    expect(res.status).toBe(400);
  });
});

describe('malformed and oversized requests', () => {
  test('malformed JSON is rejected with 400, not 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/payments/authorize',
      headers: { 'content-type': 'application/json' },
      payload: '{"account_id": "x", "amount_cents": ',
    });
    expect(res.statusCode).toBe(400);
  });

  test('a body over the size limit is rejected with 413, not 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/payments/authorize',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        account_id: accountId,
        amount_cents: 100,
        metadata: { blob: 'x'.repeat(2 * 1024 * 1024) },
      }),
    });
    expect(res.statusCode).toBe(413);
  });

  test('an unsupported content type is rejected with 415, not 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/payments/authorize',
      headers: { 'content-type': 'application/xml' },
      payload: '<payment><amount_cents>100</amount_cents></payment>',
    });
    expect(res.statusCode).toBe(415);
  });

  test('prototype pollution keys in the body are not honoured', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/payments/authorize',
      headers: { 'content-type': 'application/json' },
      payload: `{"account_id":"${accountId}","amount_cents":100,"__proto__":{"polluted":true}}`,
    });
    expect(res.statusCode).toBe(400);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
