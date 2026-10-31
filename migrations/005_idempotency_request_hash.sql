ALTER TABLE idempotency_cache ADD COLUMN IF NOT EXISTS request_hash TEXT;
