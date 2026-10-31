import sql from '../../db/client.js';

export interface CachedResponse {
  status_code: number;
  body: Record<string, unknown>;
  request_hash: string | null;
}

export async function getCachedResponse(key: string): Promise<CachedResponse | null> {
  const rows = await sql<CachedResponse[]>`
    SELECT status_code, body, request_hash FROM idempotency_cache
    WHERE key = ${key}
      AND created_at > now() - interval '24 hours'
  `;
  return rows[0] ?? null;
}

export async function setCachedResponse(
  key: string,
  statusCode: number,
  body: Record<string, unknown>,
  requestHash: string | null = null,
): Promise<void> {
  await sql`
    INSERT INTO idempotency_cache (key, status_code, body, request_hash)
    VALUES (${key}, ${statusCode}, ${sql.json(body as Parameters<typeof sql.json>[0])}, ${requestHash})
    ON CONFLICT (key) DO NOTHING
  `;
}
