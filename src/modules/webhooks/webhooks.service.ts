import type postgres from 'postgres';
import sql from '../../db/client.js';
import { getWebhookDeliveryUrl } from './webhook.config.js';
import type { WebhookEvent } from '../../shared/types.js';

function toJson(value: Record<string, unknown>): postgres.JSONValue {
  return value as unknown as postgres.JSONValue;
}

export async function insertWebhookEvent(
  transactionId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const deliveryUrl = getWebhookDeliveryUrl();
  if (!deliveryUrl) return; // no webhook configured — skip

  await sql`
    INSERT INTO webhook_events (transaction_id, event_type, payload, delivery_url)
    VALUES (${transactionId}, ${eventType}, ${sql.json(toJson(payload))}, ${deliveryUrl})
  `;
}

export async function deliverWebhookEvent(event: WebhookEvent): Promise<void> {
  const response = await fetch(event.delivery_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event.payload),
    signal: AbortSignal.timeout(5000), // 5 second timeout
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText}`);
  }
}
