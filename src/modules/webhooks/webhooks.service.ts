import sql, { toJson } from '../../db/client.js';
import { getWebhookDeliveryUrl } from './webhook.config.js';
import { signWebhook } from './webhook.signing.js';
import type { WebhookEvent } from '../../shared/types.js';

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
  const body = JSON.stringify(event.payload);
  const response = await fetch(event.delivery_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...signWebhook(body, event.id) },
    body,
    signal: AbortSignal.timeout(5000), // 5 second timeout
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText}`);
  }
}
