import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getCachedResponse, setCachedResponse } from './idempotency.service.js';

function getIdempotencyKey(request: FastifyRequest): string | undefined {
  if (request.method !== 'POST') return undefined;
  const key = request.headers['idempotency-key'] as string | undefined;
  if (!key) return undefined;
  const path = request.url.split('?')[0];
  return `${request.method}:${path}:${key}`;
}

async function idempotencyPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request, reply) => {
    const key = getIdempotencyKey(request);
    if (!key) return;

    const cached = await getCachedResponse(key);
    if (cached) {
      return reply.status(cached.status_code).send(cached.body);
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const key = getIdempotencyKey(request);
    if (!key) return payload;

    const statusCode = reply.statusCode;
    if (statusCode >= 200 && statusCode < 300) {
      let body: Record<string, unknown>;
      try {
        if (Buffer.isBuffer(payload)) {
          body = JSON.parse(payload.toString('utf-8'));
        } else if (typeof payload === 'string') {
          body = JSON.parse(payload);
        } else {
          return payload; // stream or null — don't cache
        }
      } catch {
        return payload; // not valid JSON — don't cache
      }
      await setCachedResponse(key, statusCode, body);
    }

    return payload;
  });
}

export default fp(idempotencyPlugin, { name: 'idempotency' });
