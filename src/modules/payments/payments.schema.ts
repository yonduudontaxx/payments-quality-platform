export const authorizePaymentSchema = {
  body: {
    type: 'object',
    required: ['account_id', 'amount_cents'],
    properties: {
      account_id: { type: 'string', format: 'uuid' },
      amount_cents: { type: 'integer', minimum: 1 },
      metadata: { type: 'object', additionalProperties: true },
    },
    additionalProperties: false,
  },
} as const;

export const transactionIdParamSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', format: 'uuid' },
    },
  },
} as const;
