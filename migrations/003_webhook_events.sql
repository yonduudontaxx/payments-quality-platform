CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES transactions(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  delivery_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','failed','permanently_failed')),
  attempts INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status_retry ON webhook_events(status, next_retry_at)
  WHERE status IN ('pending', 'failed');
