import { describe, it, expect } from '@jest/globals';
import { validateTransition, getResultStatus } from '../../src/modules/payments/state-machine.js';
import { PaymentError } from '../../src/shared/errors.js';

describe('validateTransition', () => {
  it('allows authorize from pending', () => {
    expect(() => validateTransition('pending', 'authorize')).not.toThrow();
  });

  it('allows capture from authorized', () => {
    expect(() => validateTransition('authorized', 'capture')).not.toThrow();
  });

  it('allows refund from captured', () => {
    expect(() => validateTransition('captured', 'refund')).not.toThrow();
  });

  it('throws PaymentError when capturing a pending transaction', () => {
    expect(() => validateTransition('pending', 'capture'))
      .toThrow(PaymentError);
  });

  it('throws PaymentError when refunding an authorized transaction', () => {
    expect(() => validateTransition('authorized', 'refund'))
      .toThrow(PaymentError);
  });

  it('throws PaymentError when authorizing a captured transaction', () => {
    expect(() => validateTransition('captured', 'authorize'))
      .toThrow(PaymentError);
  });

  it('throws with INVALID_STATE_TRANSITION code', () => {
    try {
      validateTransition('refunded', 'capture');
    } catch (err) {
      expect(err).toBeInstanceOf(PaymentError);
      expect((err as PaymentError).code).toBe('INVALID_STATE_TRANSITION');
    }
  });

  it('throws PaymentError on any transition from failed status', () => {
    expect(() => validateTransition('failed', 'capture')).toThrow(PaymentError);
    expect(() => validateTransition('failed', 'refund')).toThrow(PaymentError);
  });
});

describe('getResultStatus', () => {
  it('returns authorized for authorize', () => {
    expect(getResultStatus('authorize')).toBe('authorized');
  });

  it('returns captured for capture', () => {
    expect(getResultStatus('capture')).toBe('captured');
  });

  it('returns refunded for refund', () => {
    expect(getResultStatus('refund')).toBe('refunded');
  });
});
