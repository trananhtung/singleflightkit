/** Result of a singleflight call with metadata. */
export interface Call<T> {
  /** The resolved value. */
  value: T;
  /** True if this caller waited for a flight started by someone else. */
  shared: boolean;
}

interface Inflight<V> {
  promise: Promise<V>;
  count: number;
  shared: boolean; // whether any waiter has joined
}

/**
 * Group deduplicates concurrent async calls sharing the same key.
 * While a call is in-flight, all subsequent calls with the same key
 * receive the same result (or error) without re-running the function.
 *
 * Port of Go's `sync/singleflight`.
 *
 * @example
 * const g = new Group<string, User>();
 * const user = await g.do("user:42", () => fetchUser(42));
 */
export class Group<K = string, V = unknown> {
  private readonly _calls = new Map<K, Inflight<V>>();

  /**
   * Execute fn, or if there's already an in-flight call for the same key,
   * wait for it and return its result. All callers share the same Promise.
   *
   * On error, the in-flight entry is cleared so the next call retries.
   */
  async do(key: K, fn: () => Promise<V>): Promise<V> {
    const existing = this._calls.get(key);
    if (existing) {
      existing.count++;
      existing.shared = true;
      return existing.promise;
    }

    const promise = fn().finally(() => this._calls.delete(key));
    this._calls.set(key, { promise, count: 1, shared: false });
    return promise;
  }

  /**
   * Like `do`, but wraps the result in `Call<V>` which includes a `shared`
   * flag indicating whether this caller waited for an existing flight.
   */
  async doCall(key: K, fn: () => Promise<V>): Promise<Call<V>> {
    const existing = this._calls.get(key);
    if (existing) {
      existing.count++;
      existing.shared = true;
      const value = await existing.promise;
      return { value, shared: true };
    }

    const promise = fn().finally(() => this._calls.delete(key));
    this._calls.set(key, { promise, count: 1, shared: false });
    const value = await promise;
    return { value, shared: false };
  }

  /**
   * Forget a key immediately, so the next call with that key starts a fresh
   * flight. Existing waiters on the old flight are not affected.
   */
  forget(key: K): void {
    this._calls.delete(key);
  }

  /** Number of currently in-flight calls. */
  get size(): number {
    return this._calls.size;
  }
}

/**
 * Convenience factory — creates a pre-typed Group.
 *
 * @example
 * const g = group<number, User>();
 * const user = await g.do(42, () => fetchUser(42));
 */
export function group<K = string, V = unknown>(): Group<K, V> {
  return new Group<K, V>();
}
