CREATE TABLE IF NOT EXISTS idempotency_cache (
  key TEXT PRIMARY KEY,
  status_code INT NOT NULL,
  body JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
