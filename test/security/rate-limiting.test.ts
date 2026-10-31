import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

const LIMIT = 3;
const ORIGINAL_RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX;

let app: FastifyInstance;

function authorize(ip: string) {
  return app.inject({
    method: 'POST',
    url: '/payments/authorize',
    remoteAddress: ip,
    payload: { account_id: 'not-a-uuid', amount_cents: 1 },
  });
}

beforeAll(async () => {
  process.env.RATE_LIMIT_MAX = String(LIMIT);
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (ORIGINAL_RATE_LIMIT_MAX === undefined) delete process.env.RATE_LIMIT_MAX;
  else process.env.RATE_LIMIT_MAX = ORIGINAL_RATE_LIMIT_MAX;
});

describe('Rate limiting', () => {
  test('a client over the limit gets 429 before the request reaches validation or the database', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT; i++) statuses.push((await authorize('203.0.113.10')).statusCode);
    const limited = await authorize('203.0.113.10');

    expect(statuses).toEqual(Array(LIMIT).fill(400));
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.json()).toEqual({
      error: 'RATE_LIMITED',
      message: expect.stringMatching(/^Rate limit exceeded, retry in /),
      statusCode: 429,
    });
  });

  test('responses under the limit advertise the remaining quota', async () => {
    const res = await authorize('203.0.113.20');
    expect(res.headers['x-ratelimit-limit']).toBe(String(LIMIT));
    expect(res.headers['x-ratelimit-remaining']).toBe(String(LIMIT - 1));
  });

  test('the limit is tracked per client address', async () => {
    for (let i = 0; i <= LIMIT; i++) await authorize('203.0.113.30');
    expect((await authorize('203.0.113.30')).statusCode).toBe(429);
    expect((await authorize('203.0.113.31')).statusCode).toBe(400);
  });
});
