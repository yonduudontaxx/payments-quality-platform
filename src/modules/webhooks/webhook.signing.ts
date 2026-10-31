import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_TOLERANCE_SECONDS = 300;
const TEST_SIGNING_SECRET = 'test-webhook-signing-secret';
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;
const TIMESTAMP_PATTERN = /^\d{1,12}$/;

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export type VerificationFailure =
  | 'missing_headers'
  | 'malformed_signature'
  | 'invalid_signature'
  | 'stale_timestamp'
  | 'replayed_delivery';

export type VerificationResult =
  | { valid: true; deliveryId: string }
  | { valid: false; reason: VerificationFailure };

export interface WebhookVerifierOptions {
  secret: string;
  toleranceSeconds?: number;
  now?: () => number;
}

export function getWebhookSigningSecret(): string {
  const secret = process.env.WEBHOOK_SIGNING_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WEBHOOK_SIGNING_SECRET must be set in production');
  }
  return TEST_SIGNING_SECRET;
}

export function computeSignature(
  secret: string,
  timestamp: string,
  deliveryId: string,
  rawBody: string | Buffer,
): string {
  return createHmac('sha256', secret).update(`${timestamp}.${deliveryId}.`).update(rawBody).digest('hex');
}

export function signWebhook(
  rawBody: string,
  deliveryId: string,
  secret: string = getWebhookSigningSecret(),
  nowMs: number = Date.now(),
): Record<'X-Signature' | 'X-Timestamp' | 'X-Delivery-Id', string> {
  const timestamp = Math.floor(nowMs / 1000).toString();
  return {
    'X-Signature': `sha256=${computeSignature(secret, timestamp, deliveryId, rawBody)}`,
    'X-Timestamp': timestamp,
    'X-Delivery-Id': deliveryId,
  };
}

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function createWebhookVerifier(options: WebhookVerifierOptions) {
  if (!options.secret) throw new Error('Webhook verifier requires a signing secret');
  const toleranceMs = (options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS) * 1000;
  const now = options.now ?? Date.now;
  const seenDeliveries = new Map<string, number>();

  function forgetExpired(nowMs: number): void {
    for (const [id, expiresAt] of seenDeliveries) {
      if (expiresAt <= nowMs) seenDeliveries.delete(id);
    }
  }

  return function verify(rawBody: string | Buffer, headers: WebhookHeaders): VerificationResult {
    const signature = readHeader(headers, 'x-signature');
    const timestamp = readHeader(headers, 'x-timestamp');
    const deliveryId = readHeader(headers, 'x-delivery-id');
    if (!signature || !timestamp || !deliveryId) return { valid: false, reason: 'missing_headers' };

    const match = SIGNATURE_PATTERN.exec(signature);
    if (!match || !TIMESTAMP_PATTERN.test(timestamp)) return { valid: false, reason: 'malformed_signature' };

    const expected = Buffer.from(computeSignature(options.secret, timestamp, deliveryId, rawBody), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(match[1], 'hex'))) {
      return { valid: false, reason: 'invalid_signature' };
    }

    const nowMs = now();
    const signedAtMs = Number(timestamp) * 1000;
    if (Math.abs(nowMs - signedAtMs) > toleranceMs) return { valid: false, reason: 'stale_timestamp' };

    forgetExpired(nowMs);
    if (seenDeliveries.has(deliveryId)) return { valid: false, reason: 'replayed_delivery' };
    seenDeliveries.set(deliveryId, nowMs + 2 * toleranceMs);

    return { valid: true, deliveryId };
  };
}
