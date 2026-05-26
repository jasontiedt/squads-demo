// ─────────────────────── MVP-5 integration arc: PlayTactic buff + EndTurn ─
//
// Issue #89: MVP-5 S7 acceptance test.
//
// This integration arc binds two MVP-5 contracts into a single end-to-
// end scenario through the real Worker HTTP surface (Miniflare-style
// via MemoryKV):
//
//   1. PlayTactic typed-effect round-trip (Issue #87): seat 1 plays
//      `eng-shield-wall` (tactic, cost wild:1, effect
//      `buff-unit-stat` over `units-by-class(infantry, own)`, +1
//      health, end-of-turn). After the play, every own infantry unit
//      carries a `{stat:'health', delta:1, expires:'end-of-turn'}`
//      entry in `temporaryBuffs`; non-infantry own units and enemy
//      units are unchanged.
//
//   2. EndTurn buff cleanup (Issue #86): after seat 1 ends their
//      turn, the engine strips end-of-turn buffs from every unit
//      (own AND enemy — pinned interpretation; see decisions.md).
//      Pre-existing damage / upgrades / non-end-of-turn unit state
//      survives. The owning unit's `temporaryBuffs` field is dropped
//      when the array becomes empty (matches the optional-convention
//      used elsewhere in the schema).
//
// We pre-seed the board with two units owned by seat 1
// (`eng-watchman` — infantry, target of the buff) and seat 2
// (`eng-watchman` — also infantry, but enemy → NOT a buff target
// since `units-by-class` uses `ownership: 'own'`). This gives us a
// negative assertion: the buff applies ONLY to the actor's own
// infantry.
//
// Unit-level coverage for each contract independently already lives
// in `playTactic.test.ts` (buff-unit-stat dispatch) and
// `applyAction.test.ts` (EndTurn cleanup). This file is the MVP-5
// acceptance harness for the buff lifecycle through the Worker.

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
    // Use english on both sides so seat-2 units resolve through the
    // english catalog (the class-filter dispatch reads
    // `loadCivMeta(owner.civ)`). Using a single civ keeps the negative
    // assertion clean — "own" vs "enemy" is the only axis under test.
    body: JSON.stringify({ playerName: 'Bob', civ: 'english' }),
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

interface ActionResponse {
  readonly state: {
    readonly phase: string;
    readonly version: number;
    readonly activePlayer: number;
  };
  readonly version: number;
}

describe('MVP-5 arc — PlayTactic buff → EndTurn cleanup (eng-shield-wall)', () => {
  it('buffs own infantry then strips the buff on EndTurn', async () => {
    const { env, kv, gameCode, token1 } = await setupJoinedGame();

    // ─── 1) Advance start → mobilization → deployment ───────────────
    // PlayTactic for eng-shield-wall is gated to the deployment phase
    // via its catalog `playableIn` array.
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

    // ─── 2) Patch state: install eng-shield-wall + wild:1 + two units
    // ─── eng-watchman is class:["infantry"]; seat 1 owns one, seat 2
    // ─── owns the other. After the buff applies we expect seat 1's
    // ─── unit to carry temporaryBuffs and seat 2's to stay untouched.
    const stored = kv.peek<StoredGame>(gameKey(gameCode));
    expect(stored).not.toBeNull();
    if (stored === null) return;

    const TACTIC_CARD = 'eng-shield-wall';
    const INFANTRY_CARD = 'eng-watchman';
    const seat1 = stored.state.players[1];
    const seat2 = stored.state.players[2];
    expect(seat1).toBeDefined();
    expect(seat2).toBeDefined();
    if (seat1 === undefined || seat2 === undefined) return;

    const newHandSeat1 = [
      TACTIC_CARD,
      ...seat1.hand.slice(1).filter((c) => c !== TACTIC_CARD),
    ];
    const newDeckSeat1 = seat1.deck.filter((c) => c !== TACTIC_CARD);

    // Seat 1 infantry unit — pre-seeded with non-zero damage so the
    // +1 health buff has a meaningful observable target value if/when
    // a derived-stat surface is added. For now we just assert the buff
    // shape on the unit.
    const seat1Unit = {
      id: 'unit-test-s1-watchman',
      cardId: INFANTRY_CARD,
      owner: 1 as const,
      square: { x: 0, y: 6 },
      exhausted: false,
      damage: 1,
      attackMode: 'melee' as const,
      upgrades: [],
    };
    // Seat 2 infantry unit — same class, but enemy. The buff target
    // `units-by-class(infantry, OWN)` must skip this one.
    const seat2Unit = {
      id: 'unit-test-s2-watchman',
      cardId: INFANTRY_CARD,
      owner: 2 as const,
      square: { x: 7, y: 0 },
      exhausted: false,
      damage: 0,
      attackMode: 'melee' as const,
      upgrades: [],
    };

    const patched: StoredGame = {
      ...stored,
      state: {
        ...stored.state,
        units: [...stored.state.units, seat1Unit, seat2Unit],
        players: {
          ...stored.state.players,
          1: {
            ...seat1,
            hand: newHandSeat1,
            deck: newDeckSeat1,
            resources: [
              { id: 'res-test-w1', kind: 'wild', exhausted: false },
            ],
          },
        },
      },
    };
    await kv.put(gameKey(gameCode), JSON.stringify(patched));

    // ─── 3) POST the PlayTactic ─────────────────────────────────────
    const playRes = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 4,
      action: { type: 'PlayTactic', cardId: TACTIC_CARD },
    });
    if (playRes.status !== 200) {
      // eslint-disable-next-line no-console
      console.error('PlayTactic failed:', playRes.status, await playRes.text());
    }
    expect(playRes.status).toBe(200);
    const playBody = (await playRes.json()) as ActionResponse;
    expect(playBody.version).toBe(5);
    expect(playBody.state.phase).toBe('deployment');

    // ─── 4) Verify buff applied to seat 1's infantry, NOT seat 2's ──
    const afterPlay = kv.peek<StoredGame>(gameKey(gameCode));
    expect(afterPlay).not.toBeNull();
    if (afterPlay === null) return;

    const s1UnitAfterPlay = afterPlay.state.units.find(
      (u) => u.id === seat1Unit.id,
    );
    const s2UnitAfterPlay = afterPlay.state.units.find(
      (u) => u.id === seat2Unit.id,
    );
    expect(s1UnitAfterPlay).toBeDefined();
    expect(s2UnitAfterPlay).toBeDefined();
    if (s1UnitAfterPlay === undefined || s2UnitAfterPlay === undefined) return;

    // Seat 1 (own infantry) → buff present.
    expect(s1UnitAfterPlay.temporaryBuffs).toEqual([
      { stat: 'health', delta: 1, expires: 'end-of-turn' },
    ]);
    // Pre-existing state survives.
    expect(s1UnitAfterPlay.damage).toBe(1);

    // Seat 2 (enemy infantry) → no buff applied; the field is either
    // absent or empty. `ownership: 'own'` in the target selector must
    // exclude opponents.
    expect(s2UnitAfterPlay.temporaryBuffs).toBeUndefined();

    // Tactic moved hand → discard, resource exhausted by cost-payer.
    expect(afterPlay.state.players[1]?.discard).toContain(TACTIC_CARD);
    expect(
      afterPlay.state.players[1]?.hand.includes(TACTIC_CARD),
    ).toBe(false);

    // ─── 5) Seat 1 ends turn: EndPhase → end, then EndTurn ──────────
    // EndTurn is the cleanup hook that strips end-of-turn buffs.
    await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 5,
      action: { type: 'EndPhase' },
    });
    const endTurnRes = await postAction(env, gameCode, {
      seat: 1,
      token: token1,
      expectedVersion: 6,
      action: { type: 'EndTurn' },
    });
    expect(endTurnRes.status).toBe(200);
    const endTurnBody = (await endTurnRes.json()) as ActionResponse;
    expect(endTurnBody.version).toBe(7);
    expect(endTurnBody.state.phase).toBe('start');
    expect(endTurnBody.state.activePlayer).toBe(2);

    // ─── 6) Verify buff stripped from seat 1's unit ─────────────────
    const afterEndTurn = kv.peek<StoredGame>(gameKey(gameCode));
    expect(afterEndTurn).not.toBeNull();
    if (afterEndTurn === null) return;

    const s1UnitAfterCleanup = afterEndTurn.state.units.find(
      (u) => u.id === seat1Unit.id,
    );
    const s2UnitAfterCleanup = afterEndTurn.state.units.find(
      (u) => u.id === seat2Unit.id,
    );
    expect(s1UnitAfterCleanup).toBeDefined();
    expect(s2UnitAfterCleanup).toBeDefined();
    if (s1UnitAfterCleanup === undefined || s2UnitAfterCleanup === undefined) {
      return;
    }
    // Buff field dropped entirely (matches the schema's optional
    // convention; engine strips the array when empty).
    expect(s1UnitAfterCleanup.temporaryBuffs).toBeUndefined();
    // Non-buff unit state still intact — damage etc. survives.
    expect(s1UnitAfterCleanup.damage).toBe(1);
    expect(s1UnitAfterCleanup.owner).toBe(1);
    // Enemy unit untouched throughout.
    expect(s2UnitAfterCleanup.temporaryBuffs).toBeUndefined();
    expect(s2UnitAfterCleanup.damage).toBe(0);
  });
});
