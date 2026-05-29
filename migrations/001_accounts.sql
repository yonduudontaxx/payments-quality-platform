CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_name TEXT NOT NULL,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT now()
);
