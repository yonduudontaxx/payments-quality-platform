import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { AppError } from './shared/errors.js';
import idempotencyPlugin from './modules/idempotency/idempotency.plugin.js';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { paymentsRoutes } from './modules/payments/payments.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: process.env.NODE_ENV !== 'test',
  });

  // Core plugins
  await app.register(sensible);
  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? false,
  });

  // Idempotency plugin (must be before routes)
  await app.register(idempotencyPlugin);

  // Global error handler
  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        statusCode: error.statusCode,
      });
    }

    // Fastify validation errors (schema failures)
    if (error.validation) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
        statusCode: 400,
      });
    }

    // Unexpected errors
    app.log.error(error);
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      statusCode: 500,
    });
  });

  // Routes
  await app.register(accountsRoutes);
  await app.register(paymentsRoutes);

  return app;
}
