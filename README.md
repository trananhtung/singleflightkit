# singleflightkit

[![npm](https://img.shields.io/npm/v/singleflightkit)](https://www.npmjs.com/package/singleflightkit)
[![CI](https://github.com/trananhtung/singleflightkit/actions/workflows/ci.yml/badge.svg)](https://github.com/trananhtung/singleflightkit/actions)
[![license](https://img.shields.io/npm/l/singleflightkit)](LICENSE)

Deduplicate concurrent async calls with the same key — all waiters share one result.  
Zero dependencies. TypeScript. ESM + CJS.

```bash
npm install singleflightkit
```

## Why?

When many callers request the same resource simultaneously (cache miss, API call, DB query), you don't want N redundant operations. `singleflightkit` ensures only **one call runs** and all concurrent callers receive the same result — the same pattern as Go's [`sync/singleflight`](https://pkg.go.dev/golang.org/x/sync/singleflight).

`node-singleflight` — the only other npm equivalent — has been abandoned since 2021.

## Quick start

```ts
import { Group } from "singleflightkit";

const g = new Group<string, User>();

// Called 10 times concurrently — fetchUser() runs exactly ONCE
async function getUser(id: string): Promise<User> {
  return g.do(id, () => fetchUser(id));
}
```

## API

### `new Group<K, V>()`

Create a group. Keys are typed as `K` (default `string`), values as `V`.

```ts
const g = new Group<string, Response>();
```

### `g.do(key, fn): Promise<V>`

If no call is in-flight for `key`, runs `fn()`. Otherwise waits for the existing call and returns its result.

After `fn` resolves or rejects, the key is cleared so the next call starts fresh.

```ts
const data = await g.do("users", () => fetch("/api/users").then(r => r.json()));
```

### `g.doCall(key, fn): Promise<Call<V>>`

Like `do`, but returns `{ value: V, shared: boolean }` — `shared: true` if this caller waited for an in-flight call.

```ts
const { value, shared } = await g.doCall("config", loadConfig);
if (shared) console.log("Got cached result");
```

### `g.forget(key): void`

Immediately remove a key from the in-flight map. Subsequent calls start a fresh flight. Existing waiters are not affected.

```ts
g.forget("user:42"); // next call will re-run fn
```

### `g.size: number`

Number of currently in-flight calls.

### `group<K, V>(): Group<K, V>`

Factory function for creating a typed group.

```ts
import { group } from "singleflightkit";
const g = group<number, Post>();
```

## Examples

### Cache stampede prevention

```ts
import { Group } from "singleflightkit";

const cache = new Map<string, string>();
const g = new Group<string, string>();

async function get(key: string): Promise<string> {
  if (cache.has(key)) return cache.get(key)!;
  const value = await g.do(key, () => fetchFromDB(key));
  cache.set(key, value);
  return value;
}

// 100 concurrent calls → fetchFromDB runs ONCE
await Promise.all(Array.from({ length: 100 }, () => get("config")));
```

### API request deduplication

```ts
import { group } from "singleflightkit";

const g = group<string, unknown>();

export function apiCall(url: string): Promise<unknown> {
  return g.do(url, () => fetch(url).then(r => r.json()));
}
```

### With shared flag

```ts
const g = new Group<string, Config>();

const { value: config, shared } = await g.doCall("cfg", loadConfig);
metrics.increment(shared ? "cache_hit" : "cache_miss");
```

## Comparison

| Package | Downloads/week | Last release | Zero deps | TypeScript |
|---------|---------------|--------------|-----------|------------|
| **singleflightkit** | — | 2024 | ✅ | ✅ |
| node-singleflight | ~50 | 2021 (abandoned) | ✅ | ❌ |
| singleflight | ~100 | 2022 | ❌ | partial |

## License

MIT
