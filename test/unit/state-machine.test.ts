import { describe, it, expect } from '@jest/globals';
import { validateTransition, getResultStatus } from '../../src/modules/payments/state-machine.js';
import { PaymentError } from '../../src/shared/errors.js';
import type { TransactionStatus, TransactionType } from '../../src/shared/types.js';

describe('validateTransition — valid transitions', () => {
  const validCases: [TransactionStatus, TransactionType][] = [
    ['pending', 'authorize'],
    ['authorized', 'capture'],
    ['captured', 'refund'],
  ];

  it.each(validCases)('%s → %s does not throw', (status, operation) => {
    expect(() => validateTransition(status, operation)).not.toThrow();
  });
});

describe('validateTransition — invalid transitions', () => {
  const invalidCases: [TransactionStatus, TransactionType, string][] = [
    ['pending',    'capture',   'cannot capture a pending transaction'],
    ['pending',    'refund',    'cannot refund a pending transaction'],
    ['authorized', 'authorize', 'cannot re-authorize an authorized transaction'],
    ['authorized', 'refund',    'cannot refund an authorized transaction'],
    ['captured',   'authorize', 'cannot re-authorize a captured transaction'],
    ['captured',   'capture',   'cannot re-capture a captured transaction'],
    ['refunded',   'authorize', 'cannot re-authorize a refunded transaction'],
    ['refunded',   'capture',   'cannot capture a refunded transaction'],
    ['refunded',   'refund',    'cannot re-refund a refunded transaction'],
    ['failed',     'authorize', 'cannot authorize a failed transaction'],
    ['failed',     'capture',   'cannot capture a failed transaction'],
    ['failed',     'refund',    'cannot refund a failed transaction'],
  ];

  it.each(invalidCases)('%s → %s throws PaymentError', (status, operation) => {
    expect(() => validateTransition(status, operation)).toThrow(PaymentError);
  });

  it.each(invalidCases)('%s → %s throws with INVALID_STATE_TRANSITION code', (status, operation) => {
    let caught: unknown;
    try {
      validateTransition(status, operation);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PaymentError);
    expect((caught as PaymentError).code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('getResultStatus', () => {
  const cases: [TransactionType, TransactionStatus][] = [
    ['authorize', 'authorized'],
    ['capture',   'captured'],
    ['refund',    'refunded'],
  ];

  it.each(cases)('%s → %s', (operation, expectedStatus) => {
    expect(getResultStatus(operation)).toBe(expectedStatus);
  });
});
