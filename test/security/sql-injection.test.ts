import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql from '../../src/db/client.js';
import { request } from '../integration/helpers.js';

let app: FastifyInstance;
let accountId: string;
let transactionId: string;

const INJECTION_PAYLOADS = [
  "' OR '1'='1",
  "' OR 1=1--",
  "1; DROP TABLE accounts;--",
  "00000000-0000-0000-0000-000000000000' OR '1'='1",
  "' UNION SELECT id, owner_name, balance_cents, currency, created_at FROM accounts--",
  "'; SELECT pg_sleep(5);--",
  "\\x27 OR 1=1",
];

const LEAK_MARKERS = [/postgres/i, /syntax error/i, /\bselect\b/i, /\bunion\b/i, /pg_/i, /\bat .+\.(ts|js):\d+/, /node_modules/];

function expectNoLeak(body: unknown): void {
  const text = JSON.stringify(body ?? '');
  for (const marker of LEAK_MARKERS) expect(text).not.toMatch(marker);
  expect(text).not.toContain(accountId);
  expect(text).not.toContain(transactionId);
}

async function tableCounts(): Promise<{ accounts: number; transactions: number }> {
  const [row] = await sql<{ accounts: number; transactions: number }[]>`
    SELECT (SELECT count(*)::int FROM accounts) AS accounts,
           (SELECT count(*)::int FROM transactions) AS transactions
  `;
  return row;
}

beforeAll(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  app = await buildApp();
  await app.ready();
  const account = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Injection Target', initial_balance_cents: 50_000 },
  });
  accountId = (account.body as Record<string, unknown>).id as string;
  const auth = await request(app, 'POST', '/payments/authorize', {
    body: { account_id: accountId, amount_cents: 1_000 },
  });
  transactionId = (auth.body as Record<string, unknown>).id as string;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('SQL injection in path parameters', () => {
  const routes: Array<[string, (p: string) => string]> = [
    ['GET', (p) => `/accounts/${p}`],
    ['GET', (p) => `/payments/${p}`],
    ['POST', (p) => `/payments/${p}/capture`],
    ['POST', (p) => `/payments/${p}/refund`],
  ];

  for (const [method, path] of routes) {
    test.each(INJECTION_PAYLOADS)(`${method} ${path(':id')} rejects %p with 4xx and leaks nothing`, async (payload) => {
      const res = await request(app, method, path(encodeURIComponent(payload)));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expectNoLeak(res.body);
    });
  }
});

describe('SQL injection in the request body', () => {
  test.each(INJECTION_PAYLOADS)('account_id %p on authorize is rejected with 400', async (payload) => {
    const before = await tableCounts();
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: payload, amount_cents: 100 },
    });
    expect(res.status).toBe(400);
    expectNoLeak(res.body);
    expect(await tableCounts()).toEqual(before);
  });

  test.each(INJECTION_PAYLOADS)('owner_name %p is stored verbatim as data', async (payload) => {
    const before = await tableCounts();
    const res = await request(app, 'POST', '/accounts', {
      body: { owner_name: payload, initial_balance_cents: 0 },
    });
    expect(res.status).toBe(201);

    const id = (res.body as Record<string, unknown>).id as string;
    const [row] = await sql<{ owner_name: string }[]>`SELECT owner_name FROM accounts WHERE id = ${id}`;
    expect(row.owner_name).toBe(payload);
    expect(await tableCounts()).toEqual({ ...before, accounts: before.accounts + 1 });
  });

  test('injection strings inside metadata are stored verbatim and do not alter other rows', async () => {
    const metadata = { note: INJECTION_PAYLOADS[2], "key'); DROP TABLE transactions;--": 'x' };
    const res = await request(app, 'POST', '/payments/authorize', {
      body: { account_id: accountId, amount_cents: 10, metadata },
    });
    expect(res.status).toBe(201);
    expect((res.body as Record<string, unknown>).metadata).toEqual(metadata);

    const original = await request(app, 'GET', `/payments/${transactionId}`);
    expect(original.status).toBe(200);
    expect((original.body as Record<string, unknown>).amount_cents).toBe(1_000);
  });
});

describe('SQL injection in query strings', () => {
  test.each([
    ['status', "pending' OR '1'='1"],
    ['status', 'pending; DROP TABLE webhook_events;--'],
    ['limit', '1; DROP TABLE webhook_events;--'],
    ['limit', '1 OR 1=1'],
  ])('GET /webhooks/events?%s=%p is rejected with 400', async (param, payload) => {
    const res = await request(app, 'GET', `/webhooks/events?${param}=${encodeURIComponent(payload)}`);
    expect(res.status).toBe(400);
    expectNoLeak(res.body);
  });

  test('time-based injection does not delay the response', async () => {
    const started = Date.now();
    await request(app, 'GET', `/payments/${encodeURIComponent("'; SELECT pg_sleep(3);--")}`);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
