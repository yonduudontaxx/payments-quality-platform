import { describe, it, expect } from '@jest/globals';

// Simulate idempotency cache in memory (no DB)
type CachedResponse = { status_code: number; body: Record<string, unknown> };

function createInMemoryCache() {
  const cache = new Map<string, CachedResponse>();

  return {
    get(key: string): CachedResponse | null {
      return cache.get(key) ?? null;
    },
    set(key: string, statusCode: number, body: Record<string, unknown>): void {
      if (!cache.has(key)) {
        cache.set(key, { status_code: statusCode, body });
      }
    },
    clear(): void {
      cache.clear();
    },
  };
}

describe('Idempotency cache', () => {
  it('returns null for an unknown key', () => {
    const cache = createInMemoryCache();
    expect(cache.get('unknown-key')).toBeNull();
  });

  it('stores and retrieves a response', () => {
    const cache = createInMemoryCache();
    cache.set('key-1', 201, { id: 'abc', status: 'authorized' });
    const result = cache.get('key-1');
    expect(result).not.toBeNull();
    expect(result?.status_code).toBe(201);
    expect(result?.body).toEqual({ id: 'abc', status: 'authorized' });
  });

  it('does not overwrite an existing key (idempotent set)', () => {
    const cache = createInMemoryCache();
    cache.set('key-1', 201, { id: 'original' });
    cache.set('key-1', 200, { id: 'overwritten' }); // should be ignored
    const result = cache.get('key-1');
    expect(result?.body).toEqual({ id: 'original' });
  });

  it('different keys do not interfere', () => {
    const cache = createInMemoryCache();
    cache.set('key-A', 201, { id: 'A' });
    cache.set('key-B', 201, { id: 'B' });
    expect(cache.get('key-A')?.body.id).toBe('A');
    expect(cache.get('key-B')?.body.id).toBe('B');
  });

  it('cleared cache returns null for previously stored key', () => {
    const cache = createInMemoryCache();
    cache.set('key-1', 201, { id: 'abc' });
    cache.clear();
    expect(cache.get('key-1')).toBeNull();
  });
});
