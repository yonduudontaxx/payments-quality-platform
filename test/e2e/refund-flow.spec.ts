import { test, expect } from '@playwright/test';

test.describe('Refund Flow', () => {
  test('capture then refund restores balance', async ({ request }) => {
    // Create account
    const accountRes = await request.post('/accounts', {
      data: { owner_name: 'Refund Test User', initial_balance_cents: 100_000 },
    });
    expect(accountRes.status()).toBe(201);
    const account = await accountRes.json();

    // Authorize
    const authRes = await request.post('/payments/authorize', {
      data: { account_id: account.id, amount_cents: 30_000 },
    });
    expect(authRes.status()).toBe(201);
    const auth = await authRes.json();

    // Verify balance reduced
    const balanceAfterAuth = await request.get(`/accounts/${account.id}`);
    const balanceData = await balanceAfterAuth.json();
    expect(balanceData.balance_cents).toBe(70_000);

    // Capture
    const captureRes = await request.post(`/payments/${auth.id}/capture`);
    expect(captureRes.status()).toBe(200);

    // Refund
    const refundRes = await request.post(`/payments/${auth.id}/refund`);
    expect(refundRes.status()).toBe(200);
    const refund = await refundRes.json();
    expect(refund.status).toBe('refunded');

    // Verify balance restored
    const balanceAfterRefund = await request.get(`/accounts/${account.id}`);
    const restoredBalance = await balanceAfterRefund.json();
    expect(restoredBalance.balance_cents).toBe(100_000);
  });

  test('GET /payments/:id shows refunded status', async ({ request }) => {
    // Create account + full flow
    const accountRes = await request.post('/accounts', {
      data: { owner_name: 'Status Check User', initial_balance_cents: 50_000 },
    });
    const account = await accountRes.json();

    const authRes = await request.post('/payments/authorize', {
      data: { account_id: account.id, amount_cents: 10_000 },
    });
    const auth = await authRes.json();

    await request.post(`/payments/${auth.id}/capture`);
    await request.post(`/payments/${auth.id}/refund`);

    const statusRes = await request.get(`/payments/${auth.id}`);
    expect(statusRes.status()).toBe(200);
    const tx = await statusRes.json();
    expect(tx.status).toBe('refunded');
    expect(tx.amount_cents).toBe(10_000);
  });
});
