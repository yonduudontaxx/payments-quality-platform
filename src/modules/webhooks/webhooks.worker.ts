import sql from '../../db/client.js';
import { deliverWebhookEvent } from './webhooks.service.js';
import type { WebhookEvent } from '../../shared/types.js';
import logger from '../../shared/logger.js';

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000]; // 5 attempts
const POLL_INTERVAL_MS = 5000;

export function startWebhookWorker(): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await processPendingWebhooks();
    } catch (err) {
      logger.error({ err }, 'Webhook worker error');
    }
  }, POLL_INTERVAL_MS);
}

async function processPendingWebhooks(): Promise<void> {
  const events = await sql<WebhookEvent[]>`
    SELECT * FROM webhook_events
    WHERE status IN ('pending', 'failed')
      AND next_retry_at <= now()
    ORDER BY next_retry_at ASC
    LIMIT 10
  `;

  for (const event of events) {
    await processEvent(event);
  }
}

async function processEvent(event: WebhookEvent): Promise<void> {
  try {
    await deliverWebhookEvent(event);
    await sql`
      UPDATE webhook_events
      SET status = 'delivered', attempts = ${event.attempts + 1}
      WHERE id = ${event.id}
    `;
    logger.info({ eventId: event.id }, 'Webhook delivered');
  } catch (err) {
    const newAttempts = event.attempts + 1;
    const nextDelay = RETRY_DELAYS_MS[newAttempts - 1];
    const isFinal = newAttempts >= RETRY_DELAYS_MS.length;

    await sql`
      UPDATE webhook_events
      SET status = ${isFinal ? 'permanently_failed' : 'failed'},
          attempts = ${newAttempts},
          next_retry_at = now() + ${`${nextDelay ?? 32000} milliseconds`}::interval
      WHERE id = ${event.id}
    `;
    logger.warn({ eventId: event.id, attempts: newAttempts, isFinal }, 'Webhook delivery failed');
  }
}
