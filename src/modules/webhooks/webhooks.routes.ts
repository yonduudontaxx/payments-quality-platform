import type { FastifyInstance } from 'fastify';
import { setWebhookDeliveryUrl, getWebhookDeliveryUrl } from './webhook.config.js';
import sql from '../../db/client.js';

export async function webhooksRoutes(app: FastifyInstance): Promise<void> {
  // Configure delivery URL
  app.post('/webhooks/config', {
    schema: {
      body: {
        type: 'object',
        required: ['url'],
        properties: {
          url: { type: 'string', format: 'uri' },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const { url } = request.body as { url: string };
    setWebhookDeliveryUrl(url);
    return reply.status(201).send({ url });
  });

  // Get delivery URL config
  app.get('/webhooks/config', async (_request, reply) => {
    return reply.send({ url: getWebhookDeliveryUrl() });
  });

  // Inspect event queue
  app.get('/webhooks/events', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'delivered', 'failed', 'permanently_failed'] },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const query = request.query as { status?: string; limit?: number };
    const limit = query.limit ?? 20;

    const events = query.status
      ? await sql`SELECT * FROM webhook_events WHERE status = ${query.status} ORDER BY created_at DESC LIMIT ${limit}`
      : await sql`SELECT * FROM webhook_events ORDER BY created_at DESC LIMIT ${limit}`;

    return reply.send({ events, count: events.length });
  });
}
