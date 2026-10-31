import { describe, test, expect, afterEach } from '@jest/globals';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';

const EVIL_ORIGIN = 'https://evil.example';
const ORIGINAL_CORS_ORIGIN = process.env.CORS_ORIGIN;

let app: FastifyInstance | undefined;

async function appWithCors(corsOrigin: string | undefined): Promise<FastifyInstance> {
  if (corsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = corsOrigin;
  app = await buildApp();
  await app.ready();
  return app;
}

function get(instance: FastifyInstance, origin: string) {
  return instance.inject({ method: 'GET', url: '/webhooks/config', headers: { origin } });
}

function preflight(instance: FastifyInstance, origin: string) {
  return instance.inject({
    method: 'OPTIONS',
    url: '/payments/authorize',
    headers: {
      origin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,idempotency-key',
    },
  });
}

afterEach(async () => {
  if (app) await app.close();
  app = undefined;
  if (ORIGINAL_CORS_ORIGIN === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = ORIGINAL_CORS_ORIGIN;
});

describe('CORS', () => {
  test('with no CORS_ORIGIN configured, no origin is granted access', async () => {
    const instance = await appWithCors(undefined);
    const res = await get(instance, EVIL_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  test('with no CORS_ORIGIN configured, a cross-origin preflight is not approved', async () => {
    const instance = await appWithCors(undefined);
    const res = await preflight(instance, EVIL_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('an allowlisted origin is echoed back with Vary: Origin', async () => {
    const instance = await appWithCors('https://app.example');
    const res = await get(instance, 'https://app.example');
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(String(res.headers.vary)).toMatch(/origin/i);
  });

  test('an origin outside the allowlist receives no CORS grant', async () => {
    const instance = await appWithCors('https://app.example');
    for (const res of [await get(instance, EVIL_ORIGIN), await preflight(instance, EVIL_ORIGIN)]) {
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  test.each([
    ['suffix match', 'https://app.example.evil.example'],
    ['prefix match', 'https://evil-app.example'],
    ['scheme downgrade', 'http://app.example'],
    ['port change', 'https://app.example:8443'],
    ['null origin', 'null'],
  ])('look-alike origin (%s) receives no CORS grant', async (_name, origin) => {
    const instance = await appWithCors('https://app.example');
    const res = await get(instance, origin);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('every origin in a comma-separated allowlist is honoured individually', async () => {
    const instance = await appWithCors('https://app.example, https://admin.example');
    const app1 = await get(instance, 'https://app.example');
    const admin = await get(instance, 'https://admin.example');
    expect(app1.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(admin.headers['access-control-allow-origin']).toBe('https://admin.example');
  });

  test('a wildcard CORS_ORIGIN is never turned into a wildcard grant', async () => {
    const instance = await appWithCors('*');
    const res = await get(instance, EVIL_ORIGIN);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('credentials are never allowed cross-origin', async () => {
    const instance = await appWithCors('https://app.example');
    const res = await preflight(instance, 'https://app.example');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
