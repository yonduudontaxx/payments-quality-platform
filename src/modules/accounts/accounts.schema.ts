export const createAccountSchema = {
  body: {
    type: 'object',
    required: ['owner_name', 'initial_balance_cents'],
    properties: {
      owner_name: { type: 'string', minLength: 1 },
      initial_balance_cents: { type: 'integer', minimum: 0 },
      currency: { type: 'string', minLength: 3, maxLength: 3, default: 'USD' },
    },
    additionalProperties: false,
  },
  response: {
    201: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        owner_name: { type: 'string' },
        balance_cents: { type: 'number' },
        currency: { type: 'string' },
        created_at: { type: 'string' },
      },
    },
  },
} as const;

export const getAccountSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        owner_name: { type: 'string' },
        balance_cents: { type: 'number' },
        currency: { type: 'string' },
        created_at: { type: 'string' },
      },
    },
  },
} as const;
