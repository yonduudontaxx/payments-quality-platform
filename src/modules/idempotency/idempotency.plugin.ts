import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { getCachedResponse, setCachedResponse } from './idempotency.service.js';

async function idempotencyPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') return;

    const key = request.headers['idempotency-key'] as string | undefined;
    if (!key) return;

    const cached = await getCachedResponse(key);
    if (cached) {
      return reply.status(cached.status_code).send(cached.body);
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'POST') return payload;

    const key = request.headers['idempotency-key'] as string | undefined;
    if (!key) return payload;

    const statusCode = reply.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      const body = typeof payload === 'string' ? JSON.parse(payload) : payload;
      await setCachedResponse(key, statusCode, body);
    }

    return payload;
  });
}

export default fp(idempotencyPlugin, { name: 'idempotency' });
