// ─────────────────────────── GET /games/:code tests ─────────────────
//
// Issue #13: read a game's public state.

import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index.js';
import { memoryKV, type MemoryKV } from './helpers/memory-kv.js';

function buildEnv(kv?: MemoryKV): { env: Env; kv: MemoryKV } {
  const games = kv ?? memoryKV();
  const env: Env = {
    ALLOWED_ORIGINS: 'http://localhost:5173',
    GAMES: games as unknown as KVNamespace,
  };
  return { env, kv: games };
}

async function call(env: Env, init: RequestInit & { url: string }): Promise<Response> {
  const { url, ...rest } = init;
  const req = new Request(url, rest);
  // @ts-expect-error — test stub for ExecutionContext
  return worker.fetch(req, env, {});
}

async function createAndJoin(env: Env): Promise<{ gameCode: string }> {
  const cRes = await call(env, {
    url: 'http://example.com/games',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'Alice', civ: 'english' }),
  });
  const { gameCode } = (await cRes.json()) as { gameCode: string };
  await call(env, {
    url: `http://example.com/games/${gameCode}/join`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'Bob', civ: 'byzantines' }),
  });
  return { gameCode };
}

interface GetResponse {
  readonly state: {
    readonly version: number;
    readonly players: Record<string, { hand: { count: number } } | undefined>;
  };
  readonly version: number;
}

describe('GET /games/:code', () => {
  it('returns 200 with version + redacted state for a joined game', async () => {
    const { env } = buildEnv();
    const { gameCode } = await createAndJoin(env);

    const res = await call(env, {
      url: `http://example.com/games/${gameCode}`,
      method: 'GET',
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');

    const body = (await res.json()) as GetResponse;
    // After create (v=1) + join (v=2).
    expect(body.version).toBe(2);
    expect(body.state.version).toBe(2);

    // Hand redacted to a `{ count }` shape — never a card-id array.
    expect(body.state.players['1']?.hand).toEqual({ count: 5 });
    expect(body.state.players['2']?.hand).toEqual({ count: 5 });
  });

  it('returns 404 when the game does not exist', async () => {
    const { env } = buildEnv();
    const res = await call(env, {
      url: 'http://example.com/games/NOPE99',
      method: 'GET',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('GET response does not leak raw hand card ids', async () => {
    const { env, kv } = buildEnv();
    const { gameCode } = await createAndJoin(env);

    // Peek at the actual stored hand contents (private).
    const stored = kv.peek<{
      state: { players: Record<string, { hand: string[] } | undefined> };
    }>(`game:${gameCode}`);
    const seat1Hand = stored?.state.players['1']?.hand ?? [];
    expect(seat1Hand.length).toBe(5);

    const res = await call(env, {
      url: `http://example.com/games/${gameCode}`,
      method: 'GET',
    });
    const blob = await res.text();
    for (const cardId of seat1Hand) {
      expect(blob).not.toContain(cardId);
    }
  });
});
