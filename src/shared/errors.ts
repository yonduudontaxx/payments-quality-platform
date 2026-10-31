export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 404, 'NOT_FOUND');
  }
}

export class PaymentError extends AppError {
  constructor(message: string, code: string) {
    super(message, 422, code);
  }
}

export class IdempotencyKeyReusedError extends AppError {
  constructor() {
    super('Idempotency-Key has already been used with a different request body', 422, 'IDEMPOTENCY_KEY_REUSED');
  }
}
