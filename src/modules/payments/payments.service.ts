import type postgres from 'postgres';
import sql from '../../db/client.js';
import { AppError, NotFoundError } from '../../shared/errors.js';
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
  let result: Transaction | undefined;

  await sql.begin(async (tx) => {
    // Lock and fetch account
    const accounts = await tx<Account[]>`
      SELECT * FROM accounts WHERE id = ${input.account_id} FOR UPDATE
    `;

    if (accounts.length === 0) {
      throw new NotFoundError('Account', input.account_id);
    }

    const account = accounts[0];

    // Check sufficient funds
    if (account.balance_cents < BigInt(input.amount_cents)) {
      // Insert failed transaction
      await tx<Transaction[]>`
        INSERT INTO transactions (account_id, type, amount_cents, status, idempotency_key, metadata)
        VALUES (
          ${input.account_id},
          'authorize',
          ${input.amount_cents},
          'failed',
          ${input.idempotency_key ?? null},
          ${sql.json(toJson(input.metadata ?? {}))}
        )
        RETURNING *
      `;
      throw new AppError('Insufficient funds', 402, 'INSUFFICIENT_FUNDS');
    }

    // Deduct from balance
    await tx`
      UPDATE accounts SET balance_cents = balance_cents - ${input.amount_cents} WHERE id = ${input.account_id}
    `;

    // Insert authorized transaction
    const transactions = await tx<Transaction[]>`
      INSERT INTO transactions (account_id, type, amount_cents, status, idempotency_key, metadata)
      VALUES (
        ${input.account_id},
        'authorize',
        ${input.amount_cents},
        'authorized',
        ${input.idempotency_key ?? null},
        ${sql.json(toJson(input.metadata ?? {}))}
      )
      RETURNING *
    `;

    result = transactions[0];
  });

  return result!;
}

export async function capturePayment(id: string): Promise<Transaction> {
  const rows = await sql<Transaction[]>`SELECT * FROM transactions WHERE id = ${id}`;

  if (rows.length === 0) {
    throw new NotFoundError('Transaction', id);
  }

  const transaction = rows[0];
  validateTransition(transaction.status, 'capture');

  const updated = await sql<Transaction[]>`
    UPDATE transactions
    SET status = 'captured', updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;

  return updated[0];
}

export async function refundPayment(id: string): Promise<Transaction> {
  const rows = await sql<Transaction[]>`SELECT * FROM transactions WHERE id = ${id}`;

  if (rows.length === 0) {
    throw new NotFoundError('Transaction', id);
  }

  const transaction = rows[0];
  validateTransition(transaction.status, 'refund');

  let result: Transaction | undefined;

  await sql.begin(async (tx) => {
    const updated = await tx<Transaction[]>`
      UPDATE transactions
      SET status = 'refunded', updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;

    result = updated[0];

    const amountCents = Number(transaction.amount_cents);
    await tx`
      UPDATE accounts
      SET balance_cents = balance_cents + ${amountCents}
      WHERE id = ${transaction.account_id}
    `;
  });

  return result!;
}

export async function getTransaction(id: string): Promise<Transaction> {
  const rows = await sql<Transaction[]>`SELECT * FROM transactions WHERE id = ${id}`;

  if (rows.length === 0) {
    throw new NotFoundError('Transaction', id);
  }

  return rows[0];
}
