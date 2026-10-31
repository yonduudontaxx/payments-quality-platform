import { describe, test, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import sql, { toJson } from '../../src/db/client.js';
import { processEvent } from '../../src/modules/webhooks/webhooks.worker.js';
import { createWebhookVerifier, getWebhookSigningSecret } from '../../src/modules/webhooks/webhook.signing.js';
import type { WebhookEvent } from '../../src/shared/types.js';
import { request } from '../integration/helpers.js';

interface CapturedDelivery {
  rawBody: string;
  headers: http.IncomingHttpHeaders;
}

let app: FastifyInstance;
let transactionId: string;

function startReceiver(status: number) {
  const deliveries: CapturedDelivery[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      deliveries.push({ rawBody: Buffer.concat(chunks).toString('utf-8'), headers: req.headers });
      res.writeHead(status);
      res.end();
    });
  });
  return new Promise<{ url: string; deliveries: CapturedDelivery[]; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        deliveries,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function insertEvent(deliveryUrl: string): Promise<WebhookEvent> {
  const [event] = await sql<WebhookEvent[]>`
    INSERT INTO webhook_events (transaction_id, event_type, payload, delivery_url)
    VALUES (${transactionId}, 'payment.captured',
            ${sql.json(toJson({ transaction_id: transactionId, amount_cents: 2_500, status: 'captured' }))},
            ${deliveryUrl})
    RETURNING *
  `;
  return event;
}

beforeAll(async () => {
  await sql`TRUNCATE accounts, transactions, webhook_events, idempotency_cache RESTART IDENTITY CASCADE`;
  app = await buildApp();
  await app.ready();
  const account = await request(app, 'POST', '/accounts', {
    body: { owner_name: 'Webhook Signing User', initial_balance_cents: 10_000 },
  });
  const auth = await request(app, 'POST', '/payments/authorize', {
    body: { account_id: (account.body as Record<string, unknown>).id, amount_cents: 2_500 },
  });
  transactionId = (auth.body as Record<string, unknown>).id as string;
});

afterEach(async () => {
  await sql`TRUNCATE webhook_events`;
});

afterAll(async () => {
  if (app) await app.close();
});

describe('Signed webhook delivery', () => {
  test('the worker delivers a payload whose signature verifies against the raw body', async () => {
    const receiver = await startReceiver(200);
    try {
      const event = await insertEvent(receiver.url);
      await processEvent(event);

      expect(receiver.deliveries).toHaveLength(1);
      const [delivery] = receiver.deliveries;
      expect(delivery.headers['x-delivery-id']).toBe(event.id);
      expect(delivery.headers['x-signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(JSON.parse(delivery.rawBody)).toEqual(event.payload);

      const verify = createWebhookVerifier({ secret: getWebhookSigningSecret() });
      expect(verify(delivery.rawBody, delivery.headers)).toEqual({ valid: true, deliveryId: event.id });
    } finally {
      await receiver.close();
    }
  });

  test('a captured delivery replayed to the receiver is rejected', async () => {
    const receiver = await startReceiver(200);
    try {
      await processEvent(await insertEvent(receiver.url));
      const [delivery] = receiver.deliveries;
      const verify = createWebhookVerifier({ secret: getWebhookSigningSecret() });

      expect(verify(delivery.rawBody, delivery.headers).valid).toBe(true);
      expect(verify(delivery.rawBody, delivery.headers)).toEqual({ valid: false, reason: 'replayed_delivery' });
    } finally {
      await receiver.close();
    }
  });

  test('a captured delivery replayed under a fresh delivery id is rejected', async () => {
    const receiver = await startReceiver(200);
    try {
      await processEvent(await insertEvent(receiver.url));
      const [delivery] = receiver.deliveries;
      const verify = createWebhookVerifier({ secret: getWebhookSigningSecret() });

      const replayed = { ...delivery.headers, 'x-delivery-id': 'attacker-chosen-id' };
      expect(verify(delivery.rawBody, replayed)).toEqual({ valid: false, reason: 'invalid_signature' });
      expect(verify(delivery.rawBody, delivery.headers).valid).toBe(true);
    } finally {
      await receiver.close();
    }
  });

  test('a delivery intercepted and modified in transit fails verification', async () => {
    const receiver = await startReceiver(200);
    try {
      await processEvent(await insertEvent(receiver.url));
      const [delivery] = receiver.deliveries;
      const forged = delivery.rawBody.replace('2500', '250000');
      expect(forged).not.toBe(delivery.rawBody);

      const verify = createWebhookVerifier({ secret: getWebhookSigningSecret() });
      expect(verify(forged, delivery.headers)).toEqual({ valid: false, reason: 'invalid_signature' });
    } finally {
      await receiver.close();
    }
  });

  test('retries of one event keep the same delivery id so receivers can deduplicate', async () => {
    const receiver = await startReceiver(500);
    try {
      const event = await insertEvent(receiver.url);
      await processEvent(event);
      const [retry] = await sql<WebhookEvent[]>`SELECT * FROM webhook_events WHERE id = ${event.id}`;
      await processEvent(retry);

      expect(receiver.deliveries).toHaveLength(2);
      expect(receiver.deliveries.map((d) => d.headers['x-delivery-id'])).toEqual([event.id, event.id]);
    } finally {
      await receiver.close();
    }
  });
});
