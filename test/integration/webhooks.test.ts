import { describe, test, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import * as http from 'http';
import * as net from 'net';
import postgres from 'postgres';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql, { toJson } from '../../src/db/client.js';
import { processEvent, processPendingWebhooks, WORKER_LOCK_KEY } from '../../src/modules/webhooks/webhooks.worker.js';
import type { WebhookEvent } from '../../src/shared/types.js';
import { request } from './helpers.js';

const DB_URL = process.env.DATABASE_URL ?? 'postgres://payments:payments@localhost:5432/payments_dev';

let app: FastifyInstance;
let testTransactionId: string;

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

function createMockServer(responseStatus: number) {
  const receivedBodies: unknown[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { receivedBodies.push(JSON.parse(body)); } catch {}
      res.writeHead(responseStatus);
      res.end();
    });
  });
  const port = { value: 0 };
  return {
    receivedBodies,
    start: async () => {
      port.value = await getFreePort();
      await new Promise<void>(resolve => server.listen(port.value, resolve));
    },
    url: () => `http://localhost:${port.value}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

async function insertWebhookEventDirect(overrides: {
  delivery_url: string;
  status?: string;
  attempts?: number;
  next_retry_at?: Date | null;
  event_type?: string;
}): Promise<WebhookEvent> {
  const [event] = await sql<WebhookEvent[]>`
    INSERT INTO webhook_events (transaction_id, event_type, payload, delivery_url, status, attempts, next_retry_at)
    VALUES (
      ${testTransactionId},
      ${overrides.event_type ?? 'payment.test'},
      ${sql.json(toJson({ test: true }))},
      ${overrides.delivery_url},
      ${overrides.status ?? 'pending'},
      ${overrides.attempts ?? 0},
      ${overrides.next_retry_at !== undefined ? overrides.next_retry_at : sql`now()`}
    )
    RETURNING *
  `;
  return event;
}

beforeAll(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  app = await buildApp();
  await app.ready();

  // Create account and transaction to satisfy the webhook_events foreign key
  const accountRes = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Webhook Test User', initial_balance_cents: 200_000 },
  });
  const account = accountRes.body as Record<string, unknown>;

  const authRes = await request(app, 'POST', '/payments/authorize', {
    body: { account_id: account.id, amount_cents: 10_000 },
  });
  testTransactionId = ((authRes.body as Record<string, unknown>).id) as string;
});

afterEach(async () => {
  await sql`TRUNCATE webhook_events`;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Webhook worker — processEvent', () => {
  test('marks event as delivered on HTTP 200', async () => {
    const server = createMockServer(200);
    await server.start();
    try {
      const event = await insertWebhookEventDirect({ delivery_url: server.url() });
      await processEvent(event);

      const [updated] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${event.id}`;
      expect(updated.status).toBe('delivered');
      expect(updated.attempts).toBe(1);
    } finally {
      await server.close();
    }
  });

  test('marks event as failed with next_retry_at on HTTP 500', async () => {
    const server = createMockServer(500);
    await server.start();
    try {
      const before = Date.now();
      const event = await insertWebhookEventDirect({ delivery_url: server.url() });
      await processEvent(event);

      const [updated] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${event.id}`;
      expect(updated.status).toBe('failed');
      expect(updated.attempts).toBe(1);
      expect(updated.next_retry_at).not.toBeNull();
      // First retry delay is 2000ms — next_retry_at should be ~2s in the future
      const retryAt = new Date(updated.next_retry_at!).getTime();
      expect(retryAt).toBeGreaterThan(before + 1500);
      expect(retryAt).toBeLessThan(before + 5000);
    } finally {
      await server.close();
    }
  });

  test('marks event as permanently_failed after reaching max attempts', async () => {
    const server = createMockServer(500);
    await server.start();
    try {
      // attempts=4 means newAttempts=5 which equals RETRY_DELAYS_MS.length, triggering permanent failure
      const event = await insertWebhookEventDirect({
        delivery_url: server.url(),
        status: 'failed',
        attempts: 4,
      });
      await processEvent(event);

      const [updated] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${event.id}`;
      expect(updated.status).toBe('permanently_failed');
      expect(updated.attempts).toBe(5);
    } finally {
      await server.close();
    }
  });

  test('retry delay increases with each attempt', async () => {
    const server = createMockServer(500);
    await server.start();
    try {
      const retryAts: number[] = [];

      for (let attempts = 0; attempts < 4; attempts++) {
        await sql`TRUNCATE webhook_events`;
        const event = await insertWebhookEventDirect({
          delivery_url: server.url(),
          status: attempts === 0 ? 'pending' : 'failed',
          attempts,
        });
        const before = Date.now();
        await processEvent(event);
        const [updated] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${event.id}`;
        retryAts.push(new Date(updated.next_retry_at!).getTime() - before);
      }

      for (let i = 1; i < retryAts.length; i++) {
        expect(retryAts[i]).toBeGreaterThan(retryAts[i - 1]);
      }
    } finally {
      await server.close();
    }
  });
});

describe('Webhook worker — processPendingWebhooks', () => {
  test('processes due events and skips future ones', async () => {
    const server = createMockServer(200);
    await server.start();
    try {
      const dueEvent = await insertWebhookEventDirect({ delivery_url: server.url() });
      const futureEvent = await insertWebhookEventDirect({
        delivery_url: server.url(),
        status: 'failed',
        next_retry_at: new Date(Date.now() + 3_600_000),
      });

      await processPendingWebhooks();

      const [updatedDue] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${dueEvent.id}`;
      const [updatedFuture] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${futureEvent.id}`;

      expect(updatedDue.status).toBe('delivered');
      expect(updatedFuture.status).toBe('failed');
    } finally {
      await server.close();
    }
  });

  test('leaves the advisory lock free after a cycle', async () => {
    const server = createMockServer(200);
    await server.start();
    const probe = postgres(DB_URL, { max: 1 });
    try {
      await insertWebhookEventDirect({ delivery_url: server.url() });
      await processPendingWebhooks();

      const [{ acquired }] = await probe<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_lock(${WORKER_LOCK_KEY}) AS acquired
      `;
      expect(acquired).toBe(true);
      await probe`SELECT pg_advisory_unlock(${WORKER_LOCK_KEY})`;
    } finally {
      await probe.end();
      await server.close();
    }
  });

  test('skips the cycle when another session already holds the lock', async () => {
    const server = createMockServer(200);
    await server.start();
    const holder = postgres(DB_URL, { max: 1 });
    try {
      const [{ acquired }] = await holder<{ acquired: boolean }[]>`
        SELECT pg_try_advisory_lock(${WORKER_LOCK_KEY}) AS acquired
      `;
      expect(acquired).toBe(true);

      const event = await insertWebhookEventDirect({ delivery_url: server.url() });
      await processPendingWebhooks();

      const [row] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${event.id}`;
      expect(row.status).toBe('pending');

      await holder`SELECT pg_advisory_unlock(${WORKER_LOCK_KEY})`;
    } finally {
      await holder.end();
      await server.close();
    }
  });
});
