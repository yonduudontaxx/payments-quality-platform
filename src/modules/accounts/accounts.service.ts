import sql from '../../db/client.js';
import { NotFoundError } from '../../shared/errors.js';
import type { Account } from '../../shared/types.js';

export interface CreateAccountInput {
  owner_name: string;
  initial_balance_cents: number;
  currency?: string;
}

export async function createAccount(input: CreateAccountInput): Promise<Account> {
  const [account] = await sql<Account[]>`
    INSERT INTO accounts (owner_name, balance_cents, currency)
    VALUES (${input.owner_name}, ${input.initial_balance_cents}, ${input.currency ?? 'USD'})
    RETURNING *
  `;
  return account;
}

export async function getAccount(id: string): Promise<Account> {
  const [account] = await sql<Account[]>`
    SELECT * FROM accounts WHERE id = ${id}
  `;
  if (!account) throw new NotFoundError('Account', id);
  return account;
}
