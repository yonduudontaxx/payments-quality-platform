import { describe, it, expect } from '@jest/globals';

// The retry delays from the webhook worker
const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 32000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length; // 5

function getNextDelay(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null; // permanently failed
  return RETRY_DELAYS_MS[attempts - 1] ?? 32_000;
}

function isPermanentlyFailed(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

describe('Webhook retry backoff', () => {
  it('returns 2000ms after first failure (1 attempt)', () => {
    expect(getNextDelay(1)).toBe(2000);
  });

  it('returns 4000ms after second failure', () => {
    expect(getNextDelay(2)).toBe(4000);
  });

  it('returns 8000ms after third failure', () => {
    expect(getNextDelay(3)).toBe(8000);
  });

  it('returns 16000ms after fourth failure', () => {
    expect(getNextDelay(4)).toBe(16000);
  });

  it('returns null after 5 attempts (permanently failed)', () => {
    expect(getNextDelay(5)).toBeNull();
  });

  it('marks permanently failed after 5 attempts', () => {
    expect(isPermanentlyFailed(5)).toBe(true);
  });

  it('does not mark permanently failed before 5 attempts', () => {
    expect(isPermanentlyFailed(4)).toBe(false);
    expect(isPermanentlyFailed(3)).toBe(false);
  });

  it('delays increase with each retry', () => {
    const delays = [1, 2, 3, 4].map(a => getNextDelay(a) as number);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });
});
