import type { FastifyInstance } from 'fastify';
import { authorizePayment, capturePayment, refundPayment, getTransaction } from './payments.service.js';
import { authorizePaymentSchema, transactionIdParamSchema } from './payments.schema.js';

export async function paymentsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/payments/authorize', { schema: authorizePaymentSchema }, async (request, reply) => {
    const body = request.body as { account_id: string; amount_cents: number; metadata?: Record<string, unknown> };
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const transaction = await authorizePayment({ ...body, idempotency_key: idempotencyKey });
    return reply.status(201).send(serializeTransaction(transaction));
  });

  app.post('/payments/:id/capture', { schema: transactionIdParamSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const transaction = await capturePayment(id);
    return reply.send(serializeTransaction(transaction));
  });

  app.post('/payments/:id/refund', { schema: transactionIdParamSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const transaction = await refundPayment(id);
    return reply.send(serializeTransaction(transaction));
  });

  app.get('/payments/:id', { schema: transactionIdParamSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const transaction = await getTransaction(id);
    return reply.send(serializeTransaction(transaction));
  });
}

function serializeTransaction(tx: import('../../shared/types.js').Transaction) {
  return {
    ...tx,
    amount_cents: Number(tx.amount_cents),
    created_at: tx.created_at.toISOString(),
    updated_at: tx.updated_at.toISOString(),
  };
}
