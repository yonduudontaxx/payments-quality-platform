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

export const WORKER_LOCK_KEY = 1_234_567_890; // arbitrary unique key for this worker

export async function processPendingWebhooks(): Promise<void> {
  const conn = await sql.reserve();
  try {
    const [{ acquired }] = await conn<[{ acquired: boolean }]>`
      SELECT pg_try_advisory_lock(${WORKER_LOCK_KEY}) AS acquired
    `;
    if (!acquired) return;

    try {
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
    } finally {
      try {
        await conn`SELECT pg_advisory_unlock(${WORKER_LOCK_KEY})`;
      } catch (err) {
        logger.warn({ err }, 'Advisory unlock failed');
      }
    }
  } finally {
    conn.release();
  }
}

export async function processEvent(event: WebhookEvent): Promise<void> {
  try {
    await deliverWebhookEvent(event);
    await sql`
      UPDATE webhook_events
      SET status = 'delivered', attempts = attempts + 1
      WHERE id = ${event.id}
    `;
    logger.info({ eventId: event.id }, 'Webhook delivered');
  } catch (err) {
    const newAttempts = event.attempts + 1;
    const isFinal = newAttempts >= RETRY_DELAYS_MS.length;

    if (isFinal) {
      await sql`
        UPDATE webhook_events
        SET status = 'permanently_failed',
            attempts = attempts + 1
        WHERE id = ${event.id}
      `;
    } else {
      const nextDelayMs = RETRY_DELAYS_MS[newAttempts - 1] ?? 32_000;
      await sql`
        UPDATE webhook_events
        SET status = 'failed',
            attempts = attempts + 1,
            next_retry_at = now() + ${`${nextDelayMs} milliseconds`}::interval
        WHERE id = ${event.id}
      `;
    }
    logger.warn({ eventId: event.id, attempts: newAttempts, isFinal }, 'Webhook delivery failed');
  }
}
