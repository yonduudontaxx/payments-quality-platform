import type postgres from 'postgres';
import sql from '../../db/client.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
import { getSimulationConfig } from '../simulation/simulation.config.js';
import type { Account, Transaction } from '../../shared/types.js';
import { validateTransition } from './state-machine.js';

export interface AuthorizePaymentInput {
  account_id: string;
  amount_cents: number;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
}

function toJson(value: Record<string, unknown>): postgres.JSONValue {
  return value as unknown as postgres.JSONValue;
}

export async function authorizePayment(input: AuthorizePaymentInput): Promise<Transaction> {
  try {
    const result = await sql.begin(async (tx) => {
      const accountRows = await tx<Account[]>`
        SELECT * FROM accounts WHERE id = ${input.account_id} FOR UPDATE
      `;
      const account = accountRows[0];
      if (!account) throw new NotFoundError('Account', input.account_id);

      const { decline_rate } = getSimulationConfig();
      if (decline_rate > 0 && Math.random() < decline_rate) {
        throw new AppError('Payment declined by simulation', 402, 'SIMULATED_DECLINE');
      }

      if (account.balance_cents < BigInt(input.amount_cents)) {
        throw new AppError('Insufficient funds', 402, 'INSUFFICIENT_FUNDS');
      }

      await tx`
        UPDATE accounts SET balance_cents = balance_cents - ${input.amount_cents}
        WHERE id = ${input.account_id}
      `;
      const txRows = await tx<Transaction[]>`
        INSERT INTO transactions (account_id, type, amount_cents, status, idempotency_key, metadata)
        VALUES (${input.account_id}, 'authorize', ${input.amount_cents}, 'authorized',
                ${input.idempotency_key ?? null}, ${sql.json(toJson(input.metadata ?? {}))})
        RETURNING *
      `;
      return txRows[0];
    });
    return result;
  } catch (err) {
    if (err instanceof AppError && (err.code === 'INSUFFICIENT_FUNDS' || err.code === 'SIMULATED_DECLINE')) {
      // Persist audit record OUTSIDE the rolled-back transaction
      await sql`
        INSERT INTO transactions (account_id, type, amount_cents, status, idempotency_key, metadata)
        VALUES (${input.account_id}, 'authorize', ${input.amount_cents}, 'failed',
                ${input.idempotency_key ?? null}, ${sql.json(toJson(input.metadata ?? {}))})
      `;
    }
    throw err;
  }
}

export async function capturePayment(id: string): Promise<Transaction> {
  const result = await sql.begin(async (tx) => {
    const rows = await tx<Transaction[]>`
      SELECT * FROM transactions WHERE id = ${id} FOR UPDATE
    `;
    const transaction = rows[0];
    if (!transaction) throw new NotFoundError('Transaction', id);
    validateTransition(transaction.status, 'capture');
    const updated = await tx<Transaction[]>`
      UPDATE transactions SET status = 'captured', updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    return updated[0];
  });
  return result;
}

export async function refundPayment(id: string): Promise<Transaction> {
  const result = await sql.begin(async (tx) => {
    const rows = await tx<Transaction[]>`
      SELECT * FROM transactions WHERE id = ${id} FOR UPDATE
    `;
    const transaction = rows[0];
    if (!transaction) throw new NotFoundError('Transaction', id);
    validateTransition(transaction.status, 'refund');
    const updated = await tx<Transaction[]>`
      UPDATE transactions SET status = 'refunded', updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    await tx`
      UPDATE accounts SET balance_cents = balance_cents + ${Number(transaction.amount_cents)}
      WHERE id = ${transaction.account_id}
    `;
    return updated[0];
  });
  return result;
}

export async function getTransaction(id: string): Promise<Transaction> {
  const rows = await sql<Transaction[]>`SELECT * FROM transactions WHERE id = ${id}`;

  if (rows.length === 0) {
    throw new NotFoundError('Transaction', id);
  }

  return rows[0];
}
