import { test, expect } from '@playwright/test';
import * as http from 'http';
import * as net from 'net';

// Helper: get a free port
async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

// Helper: create webhook listener
function createWebhookListener(port: number) {
  const events: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try { events.push(JSON.parse(body)); } catch {}
      res.writeHead(200); res.end();
    });
  });
  server.listen(port);
  return {
    url: `http://localhost:${port}`,
    getEvents: () => [...events],
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}

// Helper: wait for condition
async function waitFor(
  fn: () => boolean,
  timeoutMs = 10000,
  intervalMs = 200,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

test.describe('Full Payment Lifecycle', () => {
  let webhookListener: ReturnType<typeof createWebhookListener>;

  test.beforeAll(async () => {
    const port = await getFreePort();
    webhookListener = createWebhookListener(port);
  });

  test.afterAll(async () => {
    await webhookListener.close();
  });

  test('authorize → capture → webhook received', async ({ request }) => {
    // Set a longer timeout for webhook delivery (worker polls every 5s)
    test.setTimeout(25000);

    // Configure webhook delivery
    await request.post('/webhooks/config', {
      data: { url: webhookListener.url },
    });

    // Create account
    const accountRes = await request.post('/accounts', {
      data: { owner_name: 'E2E Test User', initial_balance_cents: 200_000 },
    });
    expect(accountRes.status()).toBe(201);
    const account = await accountRes.json();

    // Authorize payment
    const authRes = await request.post('/payments/authorize', {
      data: { account_id: account.id, amount_cents: 50_000 },
      headers: { 'Idempotency-Key': 'e2e-auth-1' },
    });
    expect(authRes.status()).toBe(201);
    const authorization = await authRes.json();
    expect(authorization.status).toBe('authorized');

    // Capture payment
    const captureRes = await request.post(`/payments/${authorization.id}/capture`);
    expect(captureRes.status()).toBe(200);
    const capture = await captureRes.json();
    expect(capture.status).toBe('captured');

    // Wait for webhook delivery (worker polls every 5s)
    await waitFor(() => webhookListener.getEvents().length >= 2, 15000);

    const webhookEvents = webhookListener.getEvents();
    expect(webhookEvents.length).toBeGreaterThanOrEqual(2);

    // Verify transaction details
    const getRes = await request.get(`/payments/${authorization.id}`);
    expect(getRes.status()).toBe(200);
    const tx = await getRes.json();
    expect(tx.status).toBe('captured');
  });
});
