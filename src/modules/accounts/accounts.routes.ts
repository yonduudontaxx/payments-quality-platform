import type { FastifyInstance } from 'fastify';
import { createAccount, getAccount } from './accounts.service.js';
import { createAccountSchema, getAccountSchema } from './accounts.schema.js';
import { AppError } from '../../shared/errors.js';

export async function accountsRoutes(app: FastifyInstance): Promise<void> {
  app.post('/accounts', { schema: createAccountSchema }, async (request, reply) => {
    const body = request.body as {
      owner_name: string;
      initial_balance_cents: number;
      currency?: string;
    };
    const account = await createAccount(body);
    return reply.status(201).send({
      ...account,
      balance_cents: Number(account.balance_cents),
      created_at: account.created_at.toISOString(),
    });
  });

  app.get('/accounts/:id', { schema: getAccountSchema }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const account = await getAccount(id);
    return reply.send({
      ...account,
      balance_cents: Number(account.balance_cents),
      created_at: account.created_at.toISOString(),
    });
  });
}
