import { describe, it, expect } from '@jest/globals';

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length; // 5

function getNextDelay(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[attempts - 1] ?? 32_000;
}

function isPermanentlyFailed(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

describe('Webhook retry backoff — delay values', () => {
  const cases: [number, number][] = [
    [1, 2000],
    [2, 4000],
    [3, 8000],
    [4, 16000],
  ];

  it.each(cases)('after %i attempt(s) next delay is %ims', (attempts, expected) => {
    expect(getNextDelay(attempts)).toBe(expected);
  });

  it('delays are strictly increasing', () => {
    const delays = [1, 2, 3, 4].map(a => getNextDelay(a) as number);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('returns null at exactly MAX_ATTEMPTS (5)', () => {
    expect(getNextDelay(5)).toBeNull();
  });

  it('returns null beyond MAX_ATTEMPTS', () => {
    expect(getNextDelay(6)).toBeNull();
    expect(getNextDelay(100)).toBeNull();
  });
});

describe('Webhook retry backoff — permanent failure', () => {
  const permanentCases: [number, boolean][] = [
    [3, false],
    [4, false],
    [5, true],
    [6, true],
  ];

  it.each(permanentCases)('isPermanentlyFailed(%i) === %s', (attempts, expected) => {
    expect(isPermanentlyFailed(attempts)).toBe(expected);
  });
});
