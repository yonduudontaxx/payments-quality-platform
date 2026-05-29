import { PaymentError } from '../../shared/errors.js';
import type { TransactionStatus, TransactionType } from '../../shared/types.js';

const VALID_TRANSITIONS: Record<TransactionType, TransactionStatus> = {
  authorize: 'pending',
  capture: 'authorized',
  refund: 'captured',
};

const RESULT_STATUS: Record<TransactionType, TransactionStatus> = {
  authorize: 'authorized',
  capture: 'captured',
  refund: 'refunded',
};

export function validateTransition(
  currentStatus: TransactionStatus,
  operation: TransactionType,
): void {
  const required = VALID_TRANSITIONS[operation];
  if (currentStatus !== required) {
    throw new PaymentError(
      `Cannot ${operation} a transaction in status '${currentStatus}'. Expected '${required}'.`,
      'INVALID_STATE_TRANSITION',
    );
  }
}

export function getResultStatus(operation: TransactionType): TransactionStatus {
  return RESULT_STATUS[operation];
}
