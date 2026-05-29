import type { FastifyInstance } from 'fastify';

export async function request(
  app: FastifyInstance,
  method: string,
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
  const response = await app.inject({
    method: method as 'GET' | 'POST' | 'DELETE',
    url,
    payload: options.body,
    headers: options.headers,
  });
  return {
    status: response.statusCode,
    body: JSON.parse(response.body),
  };
}
