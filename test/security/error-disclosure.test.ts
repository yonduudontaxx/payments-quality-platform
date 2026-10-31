import { describe, test, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import type { Response as LightMyResponse } from 'light-my-request';
import { buildApp } from '../../src/app.js';
import * as paymentsService from '../../src/modules/payments/payments.service.js';

let app: FastifyInstance;

const LEAK_PATTERNS = [
  /\bat .+:\d+:\d+/,
  /\/src\//,
  /node_modules/,
  /\.ts\b/,
  /"stack"/,
  /PostgresError/,
  /relation "/,
  /DATABASE_URL/,
];

function expectSafeError(res: LightMyResponse, status: number): void {
  expect(res.statusCode).toBe(status);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  const body = res.json<Record<string, unknown>>();
  expect(Object.keys(body).sort()).toEqual(['error', 'message', 'statusCode']);
  expect(body.statusCode).toBe(status);
  for (const pattern of LEAK_PATTERNS) expect(res.body).not.toMatch(pattern);
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Error responses never expose internals', () => {
  test('an unexpected exception returns a generic 500 without its message or stack', async () => {
    jest.spyOn(paymentsService, 'getTransaction').mockRejectedValue(
      new Error('relation "transactions_secret" does not exist at /app/src/db/client.ts:12:3'),
    );
    const res = await app.inject({ method: 'GET', url: '/payments/00000000-0000-4000-8000-000000000000' });

    expectSafeError(res, 500);
    expect(res.json<Record<string, unknown>>()).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      statusCode: 500,
    });
  });

  test('a database error with a status-like property is still masked as 500', async () => {
    const dbError = Object.assign(new Error('duplicate key value violates unique constraint "accounts_pkey"'), {
      statusCode: 503,
      code: '23505',
    });
    jest.spyOn(paymentsService, 'getTransaction').mockRejectedValue(dbError);
    const res = await app.inject({ method: 'GET', url: '/payments/00000000-0000-4000-8000-000000000000' });

    expectSafeError(res, 500);
    expect(res.body).not.toContain('accounts_pkey');
  });

  test('a schema validation failure returns 400 without a stack', async () => {
    const res = await app.inject({ method: 'POST', url: '/accounts', payload: { owner_name: 1 } });
    expectSafeError(res, 400);
  });

  test('malformed JSON returns 400 without parser internals', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/accounts',
      headers: { 'content-type': 'application/json' },
      payload: '{"owner_name":',
    });
    expectSafeError(res, 400);
  });

  test('an unknown route returns 404 without a stack', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/../../etc/passwd' });
    expectSafeError(res, 404);
  });

  test('responses do not advertise the server framework', async () => {
    const res = await app.inject({ method: 'GET', url: '/webhooks/config' });
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers.server).toBeUndefined();
  });
});
