export interface Account {
  id: string;
  owner_name: string;
  balance_cents: bigint;
  currency: string;
  created_at: Date;
}

export interface Transaction {
  id: string;
  account_id: string;
  type: 'authorize' | 'capture' | 'refund';
  amount_cents: bigint;
  status: 'pending' | 'authorized' | 'captured' | 'refunded' | 'failed';
  idempotency_key: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface WebhookEvent {
  id: string;
  transaction_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  delivery_url: string;
  status: 'pending' | 'delivered' | 'failed' | 'permanently_failed';
  attempts: number;
  next_retry_at: Date | null;
  created_at: Date;
}

export type TransactionStatus = Transaction['status'];
export type TransactionType = Transaction['type'];
