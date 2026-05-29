import Fastify, { FastifyInstance } from 'fastify';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      transport:
        process.env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty' }
          : undefined,
    },
  });

  // Plugins and routes will be registered here in Phase 2
  return app;
}
