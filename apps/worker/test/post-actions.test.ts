// ─────────────────────────── POST /games/:code/actions tests ────────
//
// Issue #13: action endpoint with auth + optimistic versioning.

import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index.js';
import { memoryKV, type MemoryKV } from './helpers/memory-kv.js';
import { gameKey, type StoredGame } from '../src/kv-store.js';

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

interface SetupResult {
  readonly env: Env;
  readonly kv: MemoryKV;
  readonly gameCode: string;
  readonly token1: string;
  readonly token2: string;
}

async function setupJoinedGame(): Promise<SetupResult> {
  const { env, kv } = buildEnv();
  const cRes = await call(env, {
    url: 'http://example.com/games',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'Alice', civ: 'english' }),
  });
  const { gameCode, playerToken: token1 } = (await cRes.json()) as {
    gameCode: string;
    playerToken: string;
  };
  const jRes = await call(env, {
    url: `http://example.com/games/${gameCode}/join`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName: 'Bob', civ: 'byzantines' }),
  });
  const { playerToken: token2 } = (await jRes.json()) as { playerToken: string };
  return { env, kv, gameCode, token1, token2 };
}

async function postAction(
  env: Env,
  gameCode: string,
  body: unknown,
): Promise<Response> {
  return call(env, {
    url: `http://example.com/games/${gameCode}/actions`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

interface ActionResponse {
  readonly state: {
    readonly phase: string;
    readonly version: number;
    // Issue #38: acting seat's hand comes back as CardId[]; opponents
    // stay redacted to { count }.
    readonly players: Record<
      string,
      { hand: { count: number } | readonly string[] } | undefined
    >;
  };
  readonly version: number;
}

describe('POST /games/:code/actions — happy path', () => {
  it('EndPhase from seat 1 in start phase → 200, version 2 → 3, phase advances', async () => {
    const { env, gameCode, token1 } = await setupJoinedGame();
    const res = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionResponse;
    expect(body.version).toBe(3);
    expect(body.state.version).toBe(3);
    expect(body.state.phase).toBe('mobilization');
    // Issue #38: acting seat's own hand returns as CardId[] (length 5);
    // opponent stays redacted.
    const seat1Hand = body.state.players['1']?.hand;
    expect(Array.isArray(seat1Hand)).toBe(true);
    if (Array.isArray(seat1Hand)) expect(seat1Hand.length).toBe(5);
    expect(body.state.players['2']?.hand).toEqual({ count: 5 });
  });

  it('sequential actions advance version monotonically; reusing an old version fails 409', async () => {
    const { env, gameCode, token1 } = await setupJoinedGame();

    const first = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as ActionResponse;
    expect(firstBody.version).toBe(3);

    // Replay the same expectedVersion → stale.
    const stale = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    expect(stale.status).toBe(409);
    const staleBody = (await stale.json()) as {
      code: string;
      current: number;
      expected: number;
    };
    expect(staleBody.code).toBe('version_mismatch');
    expect(staleBody.current).toBe(3);
    expect(staleBody.expected).toBe(2);

    // Catching up to the new version succeeds.
    const next = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 3,
      action: { type: 'EndPhase' },
    });
    expect(next.status).toBe(200);
    const nextBody = (await next.json()) as ActionResponse;
    expect(nextBody.version).toBe(4);
    expect(nextBody.state.phase).toBe('deployment');
  });

  it('persists the new state + version to KV', async () => {
    const { env, kv, gameCode, token1 } = await setupJoinedGame();
    await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    const stored = kv.peek<StoredGame>(gameKey(gameCode));
    expect(stored?.state.version).toBe(3);
    expect(stored?.state.phase).toBe('mobilization');
    // Token hashes preserved across action writes.
    expect(stored?.tokenHashes[1]).toBeDefined();
    expect(stored?.tokenHashes[2]).toBeDefined();
  });

  // Issue #36: PlayCard happy path — generic card-play with "draw 1" effect.
  it('PlayCard from mobilization → 200, card moves hand→discard, deck top drawn', async () => {
    const { env, kv, gameCode, token1 } = await setupJoinedGame();

    // Advance phase: start → mobilization (PlayCard requires mob or deploy).
    const ep = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    expect(ep.status).toBe(200);

    // Peek KV to discover seat 1's hand + deck. Worker hand is redacted
    // in responses, so we use the test-side KV stub for ground truth.
    const stored = kv.peek<StoredGame>(gameKey(gameCode));
    const seat1 = stored?.state.players[1];
    expect(seat1).toBeDefined();
    expect(seat1?.hand.length).toBe(5);
    expect(seat1?.deck.length).toBeGreaterThan(0);
    const playedCard = seat1?.hand[0];
    const expectedDrawn = seat1?.deck[0];
    expect(playedCard).toBeDefined();
    expect(expectedDrawn).toBeDefined();
    if (playedCard === undefined || expectedDrawn === undefined) return;

    const handBefore = [...(seat1?.hand ?? [])];
    const discardBefore = [...(seat1?.discard ?? [])];
    const deckLenBefore = seat1?.deck.length ?? 0;

    const res = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 3,
      action: { type: 'PlayCard', cardId: playedCard },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionResponse;
    expect(body.version).toBe(4);
    expect(body.state.phase).toBe('mobilization');
    // Issue #38: acting seat's hand returns as CardId[] (length 5,
    // −1 played +1 drawn). PlayCard mutates the hand, so the client
    // needs the new contents to re-render.
    const seat1Hand = body.state.players['1']?.hand;
    expect(Array.isArray(seat1Hand)).toBe(true);
    if (Array.isArray(seat1Hand)) {
      expect(seat1Hand.length).toBe(5);
      expect(seat1Hand).not.toContain(playedCard); // played card gone
      expect(seat1Hand).toContain(expectedDrawn);  // drew deck top
    }

    // Inspect KV: card moved hand → discard, deck top consumed.
    const after = kv.peek<StoredGame>(gameKey(gameCode))?.state.players[1];
    expect(after).toBeDefined();
    if (after === undefined) return;
    expect(after.hand).not.toContain(playedCard); // played card consumed
    expect(after.hand).toContain(expectedDrawn);   // drew the top of deck
    expect(after.hand.length).toBe(handBefore.length);
    expect(after.discard).toEqual([...discardBefore, playedCard]);
    expect(after.deck.length).toBe(deckLenBefore - 1);
  });
});

describe('POST /games/:code/actions — auth failures', () => {
  it('returns 401 when the token does not match the seat hash', async () => {
    const { env, gameCode } = await setupJoinedGame();
    const res = await postAction(env, gameCode, {
      seat: 1,
      token: 'not-the-right-token',
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('unauthorized');
  });

  it("returns 401 when caller swaps seat (token belongs to seat 2 but body claims seat 1)", async () => {
    const { env, gameCode, token2 } = await setupJoinedGame();
    const res = await postAction(env, gameCode, {
      seat: 1,
      token: token2,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for an unoccupied seat (no stored hash to compare against)', async () => {
    const { env } = buildEnv();
    // Create-only game: seat 2 unoccupied.
    const cRes = await call(env, {
      url: 'http://example.com/games',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerName: 'Alice', civ: 'english' }),
    });
    const { gameCode } = (await cRes.json()) as { gameCode: string };

    const res = await postAction(env, gameCode, {
      seat: 2,
      token: 'irrelevant',
      expectedVersion: 1,
      action: { type: 'EndPhase' },
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /games/:code/actions — body / version / rules failures', () => {
  it('returns 400 invalid_json for non-JSON bodies', async () => {
    const { env, gameCode } = await setupJoinedGame();
    const res = await postAction(env, gameCode, 'not json');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_json');
  });

  it('returns 400 invalid_body for a malformed action (missing required field)', async () => {
    const { env, gameCode, token1 } = await setupJoinedGame();
    const res = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 2,
      // `action.type` references DeployUnit but is missing cardId + square.
      action: { type: 'DeployUnit' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_body');
  });

  it('returns 400 invalid_body when seat is out of range', async () => {
    const { env, gameCode, token1 } = await setupJoinedGame();
    const res = await postAction(env, gameCode, {
      seat: 99,
      token: token1,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the game does not exist', async () => {
    const { env } = buildEnv();
    const res = await postAction(env, 'NOPE99', {
      seat: 1,
      token: 'whatever',
      expectedVersion: 1,
      action: { type: 'EndPhase' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 with current/expected when expectedVersion mismatches', async () => {
    const { env, gameCode, token1 } = await setupJoinedGame();
    const res = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 99,
      action: { type: 'EndPhase' },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      code: string;
      current: number;
      expected: number;
    };
    expect(body.code).toBe('version_mismatch');
    expect(body.current).toBe(2);
    expect(body.expected).toBe(99);
  });

  it('returns 400 with engine error code when seat 2 acts on seat 1\'s turn', async () => {
    const { env, gameCode, token2 } = await setupJoinedGame();
    const res = await postAction(env, gameCode, {
      seat: 2,
      token: token2,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    // Rules-engine code from result.ts taxonomy.
    expect(body.code).toBe('not_your_turn');
  });
});
