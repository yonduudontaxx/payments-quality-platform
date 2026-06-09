import { test, expect } from '@playwright/test';

test.describe('Failure Scenarios', () => {
  test.afterEach(async ({ request }) => {
    // Reset simulation config
    await request.delete('/simulate/config');
  });

  test('insufficient funds returns 402', async ({ request }) => {
    const accountRes = await request.post('/accounts', {
      data: { owner_name: 'Poor User', initial_balance_cents: 100 },
    });
    const account = await accountRes.json();

    const res = await request.post('/payments/authorize', {
      data: { account_id: account.id, amount_cents: 10_000 },
    });
    expect(res.status()).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('INSUFFICIENT_FUNDS');
  });

  test('simulated timeout adds delay', async ({ request }) => {
    await request.post('/simulate/config', {
      data: { timeout_ms: 300 },
    });

    // Create a test account (will be delayed)
    const start = Date.now();
    const accountRes = await request.post('/accounts', {
      data: { owner_name: 'Timeout User', initial_balance_cents: 10_000 },
    });
    const elapsed = Date.now() - start;

    expect(accountRes.status()).toBe(201);
    expect(elapsed).toBeGreaterThanOrEqual(300);
  });

  test('decline_rate: 1.0 always declines authorize', async ({ request }) => {
    await request.post('/simulate/config', {
      data: { decline_rate: 1.0 },
    });

    const accountRes = await request.post('/accounts', {
      data: { owner_name: 'Decline Test User', initial_balance_cents: 500_000 },
    });
    // Note: POST /accounts is NOT /payments/authorize — simulate timeout doesn't apply to /simulate paths
    // but decline_rate applies to authorize
    const account = await accountRes.json();

    const res = await request.post('/payments/authorize', {
      data: { account_id: account.id, amount_cents: 1_000 },
    });
    expect(res.status()).toBe(402);
    const body = await res.json();
    expect(body.error).toBe('SIMULATED_DECLINE');
  });

  test('invalid state transition returns 422', async ({ request }) => {
    const accountRes = await request.post('/accounts', {
      data: { owner_name: 'State Error User', initial_balance_cents: 100_000 },
    });
    const account = await accountRes.json();

    const authRes = await request.post('/payments/authorize', {
      data: { account_id: account.id, amount_cents: 10_000 },
    });
    const auth = await authRes.json();

    // Try to refund an authorized (not yet captured) transaction
    const res = await request.post(`/payments/${auth.id}/refund`);
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('INVALID_STATE_TRANSITION');
  });
});
