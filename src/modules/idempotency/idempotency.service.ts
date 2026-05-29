import sql from '../../db/client.js';

export interface CachedResponse {
  status_code: number;
  body: Record<string, unknown>;
}

export async function getCachedResponse(key: string): Promise<CachedResponse | null> {
  const rows = await sql<CachedResponse[]>`
    SELECT status_code, body FROM idempotency_cache WHERE key = ${key}
  `;
  return rows[0] ?? null;
}

export async function setCachedResponse(
  key: string,
  statusCode: number,
  body: Record<string, unknown>,
): Promise<void> {
  await sql`
    INSERT INTO idempotency_cache (key, status_code, body)
    VALUES (${key}, ${statusCode}, ${sql.json(body as Parameters<typeof sql.json>[0])})
    ON CONFLICT (key) DO NOTHING
  `;
}
