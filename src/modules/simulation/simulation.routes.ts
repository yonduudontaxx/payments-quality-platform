import type { FastifyInstance } from 'fastify';
import { setSimulationConfig, getSimulationConfig, resetSimulationConfig } from './simulation.config.js';

export async function simulationRoutes(app: FastifyInstance): Promise<void> {
  app.post('/simulate/config', {
    schema: {
      body: {
        type: 'object',
        properties: {
          timeout_ms: { type: 'integer', minimum: 0 },
          decline_rate: { type: 'number', minimum: 0, maximum: 1 },
        },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const body = request.body as { timeout_ms?: number; decline_rate?: number };
    const updated = setSimulationConfig(body);
    return reply.send(updated);
  });

  app.get('/simulate/config', async (_request, reply) => {
    return reply.send(getSimulationConfig());
  });

  app.delete('/simulate/config', async (_request, reply) => {
    resetSimulationConfig();
    return reply.status(204).send();
  });
}
