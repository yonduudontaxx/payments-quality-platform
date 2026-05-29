import type { FastifyInstance } from 'fastify';
import type { Response as LightMyResponse } from 'light-my-request';

export async function request(
  app: FastifyInstance,
  method: string,
  url: string,
  options: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown }> {
  const response = (await app.inject({
    method: method as 'GET' | 'POST' | 'DELETE',
    url,
    payload: options.body as string | object | Buffer | NodeJS.ReadableStream | undefined,
    headers: options.headers,
  })) as LightMyResponse;
  return {
    status: response.statusCode,
    body: response.json<unknown>(),
  };
}
