// ─────────────────────────── MVP-5 integration arc: PlayAction + GET seat ─
//
// Issue #89: MVP-5 S7 acceptance test.
//
// This integration arc binds two MVP-5 contracts into a single end-to-
// end scenario through the real Worker HTTP surface (Miniflare-style
// via MemoryKV):
//
//   1. PlayAction typed-effect round-trip (Issue #87): seat 1 plays
//      `eng-levy-the-fyrd` (action, cost wild:2, effect draw 2). After
//      the round-trip, the card has moved hand → discard and 2 cards
//      have moved deck → hand. Version bumps by 1.
//
//   2. Seat-scoped GET redaction (Issue #88, #38): after the play,
//      hit `GET /games/:code?seat=N` with several seat / bearer
//      combinations and assert the redaction contract:
//        • own seat + correct bearer  → 200, own hand visible as
//          CardId[], opponents stay redacted to `{count}`.
//        • opponent seat + own bearer → 401 unauthorized.
//        • out-of-range seat          → 400 bad_request.
//
// The point is to prove these two contracts compose: a state mutation
// through POST /actions is observable through GET /games?seat=N with
// the correct redaction shape on the very next request.
//
// Unit-level coverage for each contract independently already lives in
// `post-actions.test.ts` (PlayAction) and `get-game.test.ts` (?seat=).
// This file is the MVP-5 acceptance harness.

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

async function postAction(env: Env, gameCode: string, body: unknown): Promise<Response> {
  return call(env, {
    url: `http://example.com/games/${gameCode}/actions`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify(body),
  });
}

async function getGame(
  env: Env,
  gameCode: string,
  opts: { seat?: number; bearer?: string } = {},
): Promise<Response> {
  const url = opts.seat === undefined
    ? `http://example.com/games/${gameCode}`
    : `http://example.com/games/${gameCode}?seat=${opts.seat}`;
  const headers: Record<string, string> = { Origin: 'http://localhost:5173' };
  if (opts.bearer !== undefined) headers.Authorization = `Bearer ${opts.bearer}`;
  return call(env, { url, method: 'GET', headers });
}

interface ActionResponse {
  readonly state: {
    readonly phase: string;
    readonly version: number;
    readonly players: Record<
      string,
      { hand: { count: number } | readonly string[] } | undefined
    >;
  };
  readonly version: number;
}

interface GetResponse {
  readonly state: {
    readonly version: number;
    readonly players: Record<
      string,
      { hand: { count: number } | readonly string[] } | undefined
    >;
  };
  readonly version: number;
  readonly seat?: number;
}

describe('MVP-5 arc — PlayAction → seat-scoped GET redaction', () => {
  it('plays eng-levy-the-fyrd then observes redaction across seats', async () => {
    const { env, kv, gameCode, token1, token2 } = await setupJoinedGame();

    // ─── 1) Advance start → mobilization → deployment ───────────────
    // PlayAction is gated to the deployment phase.
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

    // ─── 2) Patch state: install eng-levy-the-fyrd + wild:2 cost ────
    // The shuffled deck is non-deterministic, so we patch KV directly
    // to guarantee seat 1 holds the action card with the resources to
    // pay for it. eng-levy-the-fyrd: action, cost {wild: 2}, effect
    // {kind: 'draw', count: 2}.
    const stored = kv.peek<StoredGame>(gameKey(gameCode));
    expect(stored).not.toBeNull();
    if (stored === null) return;

    const ACTION_CARD = 'eng-levy-the-fyrd';
    const seat1 = stored.state.players[1];
    expect(seat1).toBeDefined();
    if (seat1 === undefined) return;

    const newHand = [
      ACTION_CARD,
      ...seat1.hand.slice(1).filter((c) => c !== ACTION_CARD),
    ];
    const newDeck = seat1.deck.filter((c) => c !== ACTION_CARD);
    const patched: StoredGame = {
      ...stored,
      state: {
        ...stored.state,
        players: {
          ...stored.state.players,
          1: {
            ...seat1,
            hand: newHand,
            deck: newDeck,
            resources: [
              { id: 'res-test-w1', kind: 'wild', exhausted: false },
              { id: 'res-test-w2', kind: 'wild', exhausted: false },
            ],
          },
        },
      },
    };
    await kv.put(gameKey(gameCode), JSON.stringify(patched));
    const handLenBefore = newHand.length;
    const deckLenBefore = newDeck.length;

    // ─── 3) POST the PlayAction ─────────────────────────────────────
    const playRes = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 4,
      action: { type: 'PlayAction', cardId: ACTION_CARD },
    });
    expect(playRes.status).toBe(200);
    const playBody = (await playRes.json()) as ActionResponse;
    expect(playBody.version).toBe(5);
    expect(playBody.state.phase).toBe('deployment');

    // Card left the hand, draw added 2 from the deck. Net delta +1.
    const playedSeat1Hand = playBody.state.players['1']?.hand;
    expect(Array.isArray(playedSeat1Hand)).toBe(true);
    if (Array.isArray(playedSeat1Hand)) {
      expect(playedSeat1Hand).not.toContain(ACTION_CARD);
      expect(playedSeat1Hand.length).toBe(handLenBefore - 1 + 2);
    }
    // Opponent stays redacted in the POST response too.
    expect(playBody.state.players['2']?.hand).toEqual({ count: 5 });

    // Persistent state matches: card in discard, deck shrunk by 2.
    const afterPlay = kv.peek<StoredGame>(gameKey(gameCode));
    expect(afterPlay).not.toBeNull();
    expect(afterPlay?.state.players[1]?.deck.length).toBe(deckLenBefore - 2);
    expect(afterPlay?.state.players[1]?.discard).toContain(ACTION_CARD);

    // ─── 4) GET ?seat=1 with seat-1 bearer → 200, seat 1 unredacted ─
    const get1 = await getGame(env, gameCode, { seat: 1, bearer: token1 });
    expect(get1.status).toBe(200);
    const get1Body = (await get1.json()) as GetResponse;
    expect(get1Body.version).toBe(5);
    expect(get1Body.seat).toBe(1);
    const get1Seat1Hand = get1Body.state.players['1']?.hand;
    expect(Array.isArray(get1Seat1Hand)).toBe(true);
    if (Array.isArray(get1Seat1Hand)) {
      // Card is gone from the live hand (it's in the discard).
      expect(get1Seat1Hand).not.toContain(ACTION_CARD);
      expect(get1Seat1Hand.length).toBe(handLenBefore - 1 + 2);
    }
    // Opponent stays redacted.
    expect(get1Body.state.players['2']?.hand).toEqual({ count: 5 });

    // ─── 5) GET ?seat=2 with seat-2 bearer → 200, seat 2 unredacted ─
    const get2 = await getGame(env, gameCode, { seat: 2, bearer: token2 });
    expect(get2.status).toBe(200);
    const get2Body = (await get2.json()) as GetResponse;
    expect(get2Body.seat).toBe(2);
    const get2Seat2Hand = get2Body.state.players['2']?.hand;
    expect(Array.isArray(get2Seat2Hand)).toBe(true);
    if (Array.isArray(get2Seat2Hand)) expect(get2Seat2Hand.length).toBe(5);
    // From seat 2's perspective, seat 1's hand is redacted.
    expect(get2Body.state.players['1']?.hand).toEqual({
      count: handLenBefore - 1 + 2,
    });

    // ─── 6) GET ?seat=2 with seat-1 bearer → 401 unauthorized ───────
    // Bearer-vs-seat mismatch must NOT leak seat 2's hand.
    const wrongSeat = await getGame(env, gameCode, { seat: 2, bearer: token1 });
    expect(wrongSeat.status).toBe(401);
    const wrongSeatBody = (await wrongSeat.json()) as { code: string };
    expect(wrongSeatBody.code).toBe('unauthorized');

    // ─── 7) GET ?seat=5 → 400 bad_request (out of range) ────────────
    const badSeat = await getGame(env, gameCode, { seat: 5, bearer: token1 });
    expect(badSeat.status).toBe(400);
    const badSeatBody = (await badSeat.json()) as { code: string };
    expect(badSeatBody.code).toBe('bad_request');

    // ─── 8) Anonymous GET (no ?seat=, no bearer) → both redacted ────
    // Regression guard: the seat-scoped path must not change the
    // default GET semantics.
    const anon = await getGame(env, gameCode);
    expect(anon.status).toBe(200);
    const anonBody = (await anon.json()) as GetResponse;
    expect(anonBody.seat).toBeUndefined();
    expect(anonBody.state.players['1']?.hand).toEqual({
      count: handLenBefore - 1 + 2,
    });
    expect(anonBody.state.players['2']?.hand).toEqual({ count: 5 });
  });
});
