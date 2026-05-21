// ─────────────────────────── In-memory KV stub ──────────────────────
//
// Minimal `KVNamespace` shape sufficient for create + join + lookup
// tests. The Workers KV API surface is wide, but the Worker only
// touches `get(text)` and `put(string)`. Implementing those two —
// plus `delete` for hygiene — keeps the tests fully synchronous and
// independent of Miniflare's full sandbox.
//
// Note: a real Miniflare KV namespace would also exercise
// eventually-consistent semantics. For unit tests of the handler
// contract, an in-memory map is enough; integration with the real
// runtime is covered by `wrangler dev` smoke tests, not Vitest.

export class MemoryKV {
  private readonly store = new Map<string, string>();

  async get(key: string, _type?: 'text'): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /** Test helper — peek at the stored JSON for a key. */
  peek<T>(key: string): T | null {
    const raw = this.store.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  /** Test helper — number of keys currently in the namespace. */
  size(): number {
    return this.store.size;
  }
}

/** Build a `KVNamespace`-shaped object backed by the in-memory store. */
export function memoryKV(): MemoryKV {
  return new MemoryKV();
}
