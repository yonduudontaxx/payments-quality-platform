import { describe, test, expect } from '@jest/globals';
import {
  computeSignature,
  createWebhookVerifier,
  signWebhook,
} from '../../src/modules/webhooks/webhook.signing.js';

const SECRET = 'unit-test-secret';
const NOW_MS = 1_800_000_000_000;
const BODY = JSON.stringify({ transaction_id: 'tx-1', amount_cents: 1000, status: 'captured' });

function verifierAt(nowMs: number) {
  return createWebhookVerifier({ secret: SECRET, now: () => nowMs });
}

describe('Webhook signing', () => {
  test('signs sha256 HMAC over "timestamp.deliveryId.rawBody" with all delivery headers', () => {
    const headers = signWebhook(BODY, 'delivery-1', SECRET, NOW_MS);
    const timestamp = String(NOW_MS / 1000);

    expect(headers['X-Timestamp']).toBe(timestamp);
    expect(headers['X-Delivery-Id']).toBe('delivery-1');
    expect(headers['X-Signature']).toBe(`sha256=${computeSignature(SECRET, timestamp, 'delivery-1', BODY)}`);
    expect(headers['X-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  test('a different secret produces a different signature', () => {
    const a = signWebhook(BODY, 'delivery-1', SECRET, NOW_MS);
    const b = signWebhook(BODY, 'delivery-1', 'other-secret', NOW_MS);
    expect(a['X-Signature']).not.toBe(b['X-Signature']);
  });
});

describe('Webhook verifier', () => {
  test('accepts a valid delivery', () => {
    const headers = signWebhook(BODY, 'delivery-valid', SECRET, NOW_MS);
    expect(verifierAt(NOW_MS)(BODY, headers)).toEqual({ valid: true, deliveryId: 'delivery-valid' });
  });

  test('accepts lower-case header names and a Buffer body', () => {
    const signed = signWebhook(BODY, 'delivery-lower', SECRET, NOW_MS);
    const headers = Object.fromEntries(Object.entries(signed).map(([k, v]) => [k.toLowerCase(), v]));
    expect(verifierAt(NOW_MS)(Buffer.from(BODY), headers).valid).toBe(true);
  });

  test('rejects a tampered body', () => {
    const headers = signWebhook(BODY, 'delivery-tampered', SECRET, NOW_MS);
    const tampered = BODY.replace('1000', '100000');
    expect(verifierAt(NOW_MS)(tampered, headers)).toEqual({ valid: false, reason: 'invalid_signature' });
  });

  test('rejects a tampered timestamp', () => {
    const headers = signWebhook(BODY, 'delivery-ts', SECRET, NOW_MS);
    headers['X-Timestamp'] = String(Number(headers['X-Timestamp']) + 1);
    expect(verifierAt(NOW_MS)(BODY, headers)).toEqual({ valid: false, reason: 'invalid_signature' });
  });

  test('rejects a signature made with another secret', () => {
    const headers = signWebhook(BODY, 'delivery-secret', 'attacker-secret', NOW_MS);
    expect(verifierAt(NOW_MS)(BODY, headers)).toEqual({ valid: false, reason: 'invalid_signature' });
  });

  test('rejects a signature older than five minutes', () => {
    const headers = signWebhook(BODY, 'delivery-stale', SECRET, NOW_MS);
    const verify = verifierAt(NOW_MS + 300_001);
    expect(verify(BODY, headers)).toEqual({ valid: false, reason: 'stale_timestamp' });
  });

  test('rejects a timestamp more than five minutes in the future', () => {
    const headers = signWebhook(BODY, 'delivery-future', SECRET, NOW_MS + 301_000);
    expect(verifierAt(NOW_MS)(BODY, headers)).toEqual({ valid: false, reason: 'stale_timestamp' });
  });

  test('accepts a signature just inside the five-minute tolerance', () => {
    const headers = signWebhook(BODY, 'delivery-edge', SECRET, NOW_MS);
    expect(verifierAt(NOW_MS + 299_000)(BODY, headers).valid).toBe(true);
  });

  test('rejects a replayed delivery id', () => {
    const verify = verifierAt(NOW_MS);
    const headers = signWebhook(BODY, 'delivery-replay', SECRET, NOW_MS);
    expect(verify(BODY, headers).valid).toBe(true);
    expect(verify(BODY, headers)).toEqual({ valid: false, reason: 'replayed_delivery' });
  });

  test('rejects a replayed delivery id even when re-signed with a fresh timestamp', () => {
    const verify = verifierAt(NOW_MS + 60_000);
    expect(verify(BODY, signWebhook(BODY, 'delivery-resign', SECRET, NOW_MS)).valid).toBe(true);
    const resigned = signWebhook(BODY, 'delivery-resign', SECRET, NOW_MS + 60_000);
    expect(verify(BODY, resigned)).toEqual({ valid: false, reason: 'replayed_delivery' });
  });

  test('a failed verification does not burn the delivery id', () => {
    const verify = verifierAt(NOW_MS);
    const headers = signWebhook(BODY, 'delivery-burn', SECRET, NOW_MS);
    expect(verify('{"forged":true}', headers).valid).toBe(false);
    expect(verify(BODY, headers).valid).toBe(true);
  });

  test('distinct delivery ids with the same body are both accepted', () => {
    const verify = verifierAt(NOW_MS);
    expect(verify(BODY, signWebhook(BODY, 'delivery-a', SECRET, NOW_MS)).valid).toBe(true);
    expect(verify(BODY, signWebhook(BODY, 'delivery-b', SECRET, NOW_MS)).valid).toBe(true);
  });

  test.each([
    ['X-Signature'],
    ['X-Timestamp'],
    ['X-Delivery-Id'],
  ])('rejects a delivery missing %s', (header) => {
    const headers: Record<string, string> = signWebhook(BODY, 'delivery-missing', SECRET, NOW_MS);
    delete headers[header];
    expect(verifierAt(NOW_MS)(BODY, headers)).toEqual({ valid: false, reason: 'missing_headers' });
  });

  test.each([
    ['md5 scheme', (sig: string) => sig.replace('sha256=', 'md5=')],
    ['no scheme prefix', (sig: string) => sig.replace('sha256=', '')],
    ['truncated digest', (sig: string) => sig.slice(0, -2)],
    ['non-hex digest', (sig: string) => sig.slice(0, -1) + 'z'],
  ])('rejects a malformed signature (%s)', (_name, mutate) => {
    const headers = signWebhook(BODY, 'delivery-malformed', SECRET, NOW_MS);
    headers['X-Signature'] = mutate(headers['X-Signature']);
    expect(verifierAt(NOW_MS)(BODY, headers)).toEqual({ valid: false, reason: 'malformed_signature' });
  });

  test.each([['abc'], ['1.5'], ['-1'], ['']])('rejects a non-numeric timestamp %p', (timestamp) => {
    const headers = signWebhook(BODY, 'delivery-bad-ts', SECRET, NOW_MS);
    headers['X-Timestamp'] = timestamp;
    const result = verifierAt(NOW_MS)(BODY, headers);
    expect(result.valid).toBe(false);
  });

  test('refuses to build a verifier without a secret', () => {
    expect(() => createWebhookVerifier({ secret: '' })).toThrow();
  });
});
