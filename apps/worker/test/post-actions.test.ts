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

  // Issue #87: PlayAction happy path — re-enabled after Sabine's
  // catalog backfill typed every Action/Tactic effect against the
  // locked Effect DSL. We use `eng-levy-the-fyrd` (action, cost wild:2,
  // effect `{kind:'draw', count:2}`) as the canonical typed action.
  //
  // The deck shuffle is seeded with `newSeed()` per game (non-
  // deterministic for tests), so we mutate KV directly to install:
  //   • `eng-levy-the-fyrd` at hand[0] for seat 1
  //   • two unexhausted `wild` resource tokens to cover the cost
  // ...then drive PlayAction through the real HTTP handler.
  it('PlayAction happy path — typed draw effect (eng-levy-the-fyrd)', async () => {
    const { env, kv, gameCode, token1 } = await setupJoinedGame();

    // Advance start → mobilization → deployment (PlayAction is
    // deployment-only per phases.ts).
    await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 2,
      action: { type: 'EndPhase' },
    });
    await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 3,
      action: { type: 'EndPhase' },
    });

    // Install a known action card and the resources needed to pay
    // its cost directly into the persisted state.
    const stored = kv.peek<StoredGame>(gameKey(gameCode));
    expect(stored).not.toBeNull();
    if (stored === null) return; // narrow for TS

    const ACTION_CARD = 'eng-levy-the-fyrd';
    const seat1 = stored.state.players[1];
    expect(seat1).toBeDefined();
    if (seat1 === undefined) return;

    const newHand = [ACTION_CARD, ...seat1.hand.slice(1)];
    // Strip ACTION_CARD from the deck so the post-play draw can't
    // accidentally pull it back into the hand — that would defeat the
    // `not.toContain(ACTION_CARD)` assertion below.
    const newDeck = seat1.deck.filter((c) => c !== ACTION_CARD);
    const newResources = [
      { id: 'res-test-w1', kind: 'wild' as const, exhausted: false },
      { id: 'res-test-w2', kind: 'wild' as const, exhausted: false },
    ];
    const patched = {
      ...stored,
      state: {
        ...stored.state,
        players: {
          ...stored.state.players,
          1: { ...seat1, hand: newHand, deck: newDeck, resources: newResources },
        },
      },
    };
    await kv.put(gameKey(gameCode), JSON.stringify(patched));

    const handLenBefore = newHand.length;
    const deckLenBefore = newDeck.length;

    const res = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 4,
      action: { type: 'PlayAction', cardId: ACTION_CARD },
    });

    if (res.status !== 200) {
      // eslint-disable-next-line no-console
      console.error('PlayAction failed:', res.status, await res.text());
    }
    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionResponse;
    expect(body.version).toBe(5);
    expect(body.state.phase).toBe('deployment');

    // Card moved hand → discard, then draw effect added 2 cards from
    // deck. Net hand delta: -1 (play) + 2 (draw) = +1.
    const seat1Hand = body.state.players['1']?.hand;
    expect(Array.isArray(seat1Hand)).toBe(true);
    if (Array.isArray(seat1Hand)) {
      expect(seat1Hand).not.toContain(ACTION_CARD);
      expect(seat1Hand.length).toBe(handLenBefore - 1 + 2);
    }

    // Verify deck shrank by 2 (the drawn cards) via KV peek.
    const after = kv.peek<StoredGame>(gameKey(gameCode));
    expect(after?.state.players[1]?.deck.length).toBe(deckLenBefore - 2);
    expect(after?.state.players[1]?.discard).toContain(ACTION_CARD);
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
