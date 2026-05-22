// ─────────────────────────── POST /games + /join tests ──────────────
//
// Exercises issue #12 end-to-end against an in-memory KV stub. Verifies:
//   • response shape (gameCode/playerToken/seat),
//   • KV write contract (sha256 hashing — never plaintext tokens),
//   • initial-state shape (Zod parse + seat 1 only at create),
//   • join flow folds seat 2, both have 5-card hands,
//   • both supported civs work,
//   • duplicate join → 409,
//   • unknown civ + missing fields → 400.

import { describe, expect, it } from 'vitest';
import { GameState } from '@eoe/schema';
import worker, { type Env } from '../src/index.js';
import { sha256Hex } from '../src/random.js';
import { gameKey, type StoredGame } from '../src/kv-store.js';
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

interface CreateResponse {
  readonly gameCode: string;
  readonly playerToken: string;
  readonly seat: 1;
}

interface JoinResponse {
  readonly playerToken: string;
  readonly seat: 2;
}

async function createGame(
  env: Env,
  body: Record<string, unknown>,
): Promise<{ res: Response; payload: CreateResponse }> {
  const res = await call(env, {
    url: 'http://example.com/games',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as CreateResponse;
  return { res, payload };
}

async function joinGame(
  env: Env,
  code: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; payload: JoinResponse }> {
  const res = await call(env, {
    url: `http://example.com/games/${code}/join`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as JoinResponse;
  return { res, payload };
}

// ─────────────────────────── POST /games ─────────────────────────────

describe('POST /games — create game', () => {
  it('returns gameCode + playerToken + seat 1 on a valid English create', async () => {
    const { env, kv } = buildEnv();
    const { res, payload } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });

    expect(res.status).toBe(200);
    expect(payload.gameCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(payload.playerToken.length).toBeGreaterThanOrEqual(32);
    expect(payload.seat).toBe(1);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(kv.size()).toBe(1);
  });

  it('persists a Zod-valid GameState with seat 1 only', async () => {
    const { env, kv } = buildEnv();
    const { payload } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });

    const stored = kv.peek<StoredGame>(gameKey(payload.gameCode));
    expect(stored).not.toBeNull();
    // Round-trip through Zod — proves the state shape is canonical.
    expect(() => GameState.parse(stored?.state)).not.toThrow();
    expect(stored?.state.version).toBe(1);
    expect(stored?.state.phase).toBe('start');
    expect(stored?.state.activePlayer).toBe(1);
    expect(stored?.state.turn).toBe(1);
    expect(stored?.state.players[1]).toBeDefined();
    expect(stored?.state.players[2]).toBeUndefined();
  });

  it('seat-1 hand has 5 cards drawn from the civ deck', async () => {
    const { env, kv } = buildEnv();
    const { payload } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    const stored = kv.peek<StoredGame>(gameKey(payload.gameCode));
    expect(stored?.state.players[1]?.hand.length).toBe(5);
    expect(stored?.state.players[1]?.deck.length).toBeGreaterThan(0);
  });

  it('stores the sha256 of the token, never the plaintext', async () => {
    const { env, kv } = buildEnv();
    const { payload } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });

    const stored = kv.peek<StoredGame>(gameKey(payload.gameCode));
    const expected = await sha256Hex(payload.playerToken);
    expect(stored?.tokenHashes[1]).toBe(expected);
    // The raw token must not appear anywhere in the stored value.
    const blob = JSON.stringify(stored);
    expect(blob).not.toContain(payload.playerToken);
  });

  it('supports byzantines as the creator civ', async () => {
    const { env, kv } = buildEnv();
    const { res, payload } = await createGame(env, {
      playerName: 'Bob',
      civ: 'byzantines',
    });
    expect(res.status).toBe(200);
    const stored = kv.peek<StoredGame>(gameKey(payload.gameCode));
    expect(stored?.state.players[1]?.civ).toBe('byzantines');
    expect(stored?.state.players[1]?.hand.length).toBe(5);
  });

  it('rejects missing civ field with 400', async () => {
    const { env } = buildEnv();
    const res = await call(env, {
      url: 'http://example.com/games',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('rejects an unknown civ with 400', async () => {
    const { env } = buildEnv();
    const res = await call(env, {
      url: 'http://example.com/games',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice', civ: 'martians' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-JSON bodies with 400 invalid_json', async () => {
    const { env } = buildEnv();
    const res = await call(env, {
      url: 'http://example.com/games',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_json');
  });
});

// ─────────────────────────── POST /games/:code/join ──────────────────

describe('POST /games/:code/join — second player', () => {
  it('folds seat 2 in, bumps version, both hands sized 5', async () => {
    const { env, kv } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    const { res, payload: joined } = await joinGame(env, created.gameCode, {
      playerName: 'Bob',
      civ: 'byzantines',
    });

    expect(res.status).toBe(200);
    expect(joined.seat).toBe(2);
    expect(joined.playerToken.length).toBeGreaterThanOrEqual(32);

    const stored = kv.peek<StoredGame>(gameKey(created.gameCode));
    expect(() => GameState.parse(stored?.state)).not.toThrow();
    expect(stored?.state.version).toBe(2);
    expect(stored?.state.players[1]?.hand.length).toBe(5);
    expect(stored?.state.players[2]?.hand.length).toBe(5);
    expect(stored?.state.players[2]?.civ).toBe('byzantines');
    expect(stored?.state.buildings.filter((b) => b.type === 'capital')).toHaveLength(2);
    expect(stored?.state.map.tiles).toHaveLength(2);
  });

  it('seat 2 carries firstPlayerSecondPlayerWild = true', async () => {
    const { env, kv } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    await joinGame(env, created.gameCode, { playerName: 'Bob', civ: 'byzantines' });
    const stored = kv.peek<StoredGame>(gameKey(created.gameCode));
    expect(stored?.state.players[2]?.firstPlayerSecondPlayerWild).toBe(true);
    expect(stored?.state.players[1]?.firstPlayerSecondPlayerWild).toBeUndefined();
  });

  it('stores both token hashes, neither plaintext', async () => {
    const { env, kv } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    const { payload: joined } = await joinGame(env, created.gameCode, {
      playerName: 'Bob',
      civ: 'byzantines',
    });

    const stored = kv.peek<StoredGame>(gameKey(created.gameCode));
    expect(stored?.tokenHashes[1]).toBe(await sha256Hex(created.playerToken));
    expect(stored?.tokenHashes[2]).toBe(await sha256Hex(joined.playerToken));
    const blob = JSON.stringify(stored);
    expect(blob).not.toContain(created.playerToken);
    expect(blob).not.toContain(joined.playerToken);
  });

  it('capitals sit at opposite corners (0,0) and (5,5)', async () => {
    const { env, kv } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    await joinGame(env, created.gameCode, { playerName: 'Bob', civ: 'byzantines' });
    const stored = kv.peek<StoredGame>(gameKey(created.gameCode));
    expect(stored?.state.players[1]?.capitalSquare).toEqual({ x: 0, y: 0 });
    expect(stored?.state.players[2]?.capitalSquare).toEqual({ x: 5, y: 5 });
  });

  it('persists both capitals with #57 ids, default HP, and empty units[] (POST /games + join)', async () => {
    const { env, kv } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    await joinGame(env, created.gameCode, { playerName: 'Bob', civ: 'byzantines' });
    const stored = kv.peek<StoredGame>(gameKey(created.gameCode));

    const capitals = stored?.state.buildings.filter((b) => b.type === 'capital') ?? [];
    expect(capitals).toHaveLength(2);
    expect(capitals.map((c) => c.id).sort()).toEqual(['bld-cap-p1', 'bld-cap-p2']);

    expect(stored?.state.players[1]?.capitalHp).toBe(20);
    expect(stored?.state.players[2]?.capitalHp).toBe(20);
    expect(stored?.state.units).toEqual([]);

    // Both starting tiles are face-up so units can deploy onto them.
    expect(stored?.state.map.tiles.every((t) => t.faceDown === false)).toBe(true);
  });

  it('rejects a join on a full game with 409', async () => {
    const { env } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    await joinGame(env, created.gameCode, { playerName: 'Bob', civ: 'byzantines' });

    const res = await call(env, {
      url: `http://example.com/games/${created.gameCode}/join`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Carol', civ: 'english' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('game_full');
  });

  it('rejects join on an unknown gameCode with 404', async () => {
    const { env } = buildEnv();
    const res = await call(env, {
      url: 'http://example.com/games/ZZZZZZ/join',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Bob', civ: 'english' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });

  it('rejects a join with bad civ via 400', async () => {
    const { env } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    const res = await call(env, {
      url: `http://example.com/games/${created.gameCode}/join`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Bob', civ: 'klingons' }),
    });
    expect(res.status).toBe(400);
  });

  it('allows both players to pick english (same civ — no civ-uniqueness rule)', async () => {
    const { env, kv } = buildEnv();
    const { payload: created } = await createGame(env, {
      playerName: 'Alice',
      civ: 'english',
    });
    const { res } = await joinGame(env, created.gameCode, {
      playerName: 'Bob',
      civ: 'english',
    });
    expect(res.status).toBe(200);
    const stored = kv.peek<StoredGame>(gameKey(created.gameCode));
    expect(stored?.state.players[1]?.civ).toBe('english');
    expect(stored?.state.players[2]?.civ).toBe('english');
  });
});

// ─────────────────────────── Routing/CORS ────────────────────────────

describe('routing', () => {
  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const { env } = buildEnv();
    const res = await call(env, {
      url: 'http://example.com/games',
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('unknown paths return 404 with structured body', async () => {
    const { env } = buildEnv();
    const res = await call(env, {
      url: 'http://example.com/nope',
      method: 'GET',
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('not_found');
  });
});
