import {
  type Action,
  type CardId,
  type GameState,
  type Player,
  type ResourceToken,
  type ResourceTokenId,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_2, SEAT_1 } from './fixtures.js';

// ─────────────────────────── DeployUnit (Issue #8) ───────────────────
//
// MVP Capital-only deploy. Every test below uses real catalog data
// from `@eoe/assets-meta`:
//
//   - `eng-watchman`        — kind 'unit', cost { wild: 1 }
//   - `eng-levy-the-fyrd`   — kind 'action' (for kind-mismatch test)
//
// Seat 1 / English is used because the English catalog ships a
// cost-`{ wild: 1 }` unit (`eng-watchman`), letting the happy-path
// assertions stay symmetric (one token in, one token exhausted out).
// Byzantines stubs all cost ≥ 2 (see #58 / #17).
//
// We do NOT mutate the shared `baseState`; tests derive fresh state
// objects via helpers below. The shared fixture lives in `fixtures.ts`
// and stays focused on phase-machine tests.

const cid = (s: string): CardId => s as CardId;
const rtid = (s: string): ResourceTokenId => s as ResourceTokenId;

// ─── Test helpers ────────────────────────────────────────────────────

interface DeployStateOpts {
  hand?: ReadonlyArray<string>;
  resources?: ReadonlyArray<ResourceToken>;
}

/**
 * Build a deploy-ready state: phase 'deployment', active seat 1
 * (english — `eng-watchman` lives in their catalog at cost { wild: 1 }),
 * Player 1 has whatever hand + resources the test wants.
 */
function deployState(opts: DeployStateOpts = {}): GameState {
  const seat1 = baseState.players[1];
  if (seat1 === undefined) {
    throw new Error('baseState must seat player 1 — fixture invariant violated');
  }
  const player: Player = {
    ...seat1,
    hand: (opts.hand ?? ['eng-watchman']).map(cid),
    resources: [
      ...(opts.resources ?? [
        {
          id: rtid('rt-eng-wild-1'),
          kind: 'wild' as const,
          exhausted: false,
        },
      ]),
    ],
  };
  return {
    ...baseState,
    phase: 'deployment',
    activePlayer: 1,
    players: { ...baseState.players, 1: player },
  };
}

const deployEngUnit = (square: { x: number; y: number }): Action =>
  ({
    type: 'DeployUnit',
    cardId: cid('eng-watchman'),
    square,
  }) as unknown as Action;

// ─── Happy path ──────────────────────────────────────────────────────

describe('DeployUnit — happy path', () => {
  it('places a new unit on the capital, decrements hand, increments discard, exhausts the wild token', () => {
    const state = deployState();
    const player = state.players[1];
    expect(player).toBeDefined();
    if (player === undefined) return;

    const action = deployEngUnit(player.capitalSquare);
    const result = applyAction(state, action, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const next = result.value;
    const newPlayer = next.players[1];
    expect(newPlayer).toBeDefined();
    if (newPlayer === undefined) return;

    // Hand decremented (card removed).
    expect(newPlayer.hand).toEqual([]);
    // Discard now contains the played card.
    expect(newPlayer.discard).toEqual([cid('eng-watchman')]);
    // The wild token is exhausted; original was unexhausted.
    expect(newPlayer.resources).toHaveLength(1);
    expect(newPlayer.resources[0]?.exhausted).toBe(true);
    expect(newPlayer.resources[0]?.kind).toBe('wild');

    // A new unit instance lives on the board.
    expect(next.units).toHaveLength(1);
    const newUnit = next.units[0];
    expect(newUnit).toBeDefined();
    if (newUnit === undefined) return;
    expect(newUnit.cardId).toBe(cid('eng-watchman'));
    expect(newUnit.owner).toBe(1);
    expect(newUnit.square).toEqual(player.capitalSquare);
    expect(newUnit.exhausted).toBe(false);
    expect(newUnit.damage).toBe(0);
    expect(newUnit.attackMode).toBe('melee');
    expect(newUnit.upgrades).toEqual([]);
    // Deterministic id (turn 1, seat 1, 0 existing units).
    expect(newUnit.id).toBe('unit-1-1-0');

    // Issue #53: version bumps by exactly 1 on success — drives
    // optimistic concurrency on the worker side.
    expect(next.version).toBe(state.version + 1);
  });

  it('does not mutate the input state', () => {
    const state = deployState();
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const snapshot = JSON.stringify(state);
    applyAction(state, deployEngUnit(player.capitalSquare), SEAT_1);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('returns a new state object (no shared reference)', () => {
    const state = deployState();
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(state, deployEngUnit(player.capitalSquare), SEAT_1);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).not.toBe(state);
    expect(result.value.units).not.toBe(state.units);
    expect(result.value.players).not.toBe(state.players);
  });
});

// ─── Determinism ─────────────────────────────────────────────────────

describe('DeployUnit — determinism', () => {
  it('produces byte-equal results for two clones of the same state + action', () => {
    const state1 = deployState();
    const state2: GameState = JSON.parse(JSON.stringify(state1)) as GameState;
    const player = state1.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const action = deployEngUnit(player.capitalSquare);

    const r1 = applyAction(state1, action, SEAT_1);
    const r2 = applyAction(state2, action, SEAT_1);

    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(JSON.stringify(r1.value)).toBe(JSON.stringify(r2.value));
  });

  it('increments the positional id when an existing unit is owned by the actor', () => {
    const state = deployState({
      hand: ['eng-watchman', 'eng-watchman'],
      resources: [
        { id: rtid('rt-1'), kind: 'wild', exhausted: false },
        { id: rtid('rt-2'), kind: 'wild', exhausted: false },
      ],
    });
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const action = deployEngUnit(player.capitalSquare);

    const r1 = applyAction(state, action, SEAT_1);
    if (!r1.ok) throw new Error('first deploy must succeed');

    const r2 = applyAction(r1.value, action, SEAT_1);
    if (!r2.ok) throw new Error('second deploy must succeed');

    expect(r1.value.units[0]?.id).toBe('unit-1-1-0');
    expect(r2.value.units[1]?.id).toBe('unit-1-1-1');
  });
});

// ─── Gate failures (confirm dispatch reaches the right error) ────────

describe('DeployUnit — gate failures', () => {
  it('wrong phase: rejects DeployUnit outside deployment', () => {
    const state: GameState = { ...deployState(), phase: 'mobilization' };
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(
      state,
      deployEngUnit(player.capitalSquare),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('wrong seat: rejects when actor is not the active player', () => {
    const state = deployState();
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(
      state,
      deployEngUnit(player.capitalSquare),
      SEAT_2,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });
});

// ─── Effect-level failures ───────────────────────────────────────────

describe('DeployUnit — effect failures', () => {
  it("card_not_in_hand: rejects when the cardId isn't in the actor's hand", () => {
    const state = deployState({ hand: [] });
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(
      state,
      deployEngUnit(player.capitalSquare),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_hand');
  });

  it('card_not_unit: rejects when the card is not a unit kind', () => {
    // eng-levy-the-fyrd is an 'action' card in the catalog.
    const state = deployState({ hand: ['eng-levy-the-fyrd'] });
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const action: Action = {
      type: 'DeployUnit',
      cardId: cid('eng-levy-the-fyrd'),
      square: player.capitalSquare,
    } as unknown as Action;
    const result = applyAction(state, action, SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_unit');
  });

  it('card_not_in_catalog: rejects when cardId is in hand but not in the civ catalog', () => {
    const state = deployState({ hand: ['ghost-card-id'] });
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const action: Action = {
      type: 'DeployUnit',
      cardId: cid('ghost-card-id'),
      square: player.capitalSquare,
    } as unknown as Action;
    const result = applyAction(state, action, SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_catalog');
  });

  it('invalid_deploy_square: rejects when target square is not the actor capital (MVP)', () => {
    const state = deployState();
    // baseState seats English at (0,0) — pick anywhere else.
    const result = applyAction(
      state,
      deployEngUnit({ x: 5, y: 5 }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_deploy_square');
  });

  it('invalid_deploy_square: rejects when the target tile is face-down (Issue #53)', () => {
    // Flip the English starting tile (the one containing (0,0)) to
    // faceDown — placement zone exists but is not revealed yet.
    const base = deployState();
    const state: GameState = {
      ...base,
      map: {
        ...base.map,
        tiles: base.map.tiles.map((t) =>
          t.squares.some((s) => s.coord.x === 0 && s.coord.y === 0)
            ? { ...t, faceDown: true }
            : t,
        ),
      },
    };
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(
      state,
      deployEngUnit(player.capitalSquare),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_deploy_square');
      expect(result.error.message).toMatch(/face-down/);
    }
  });

  it('insufficient_resources: rejects when no unexhausted token covers the cost', () => {
    // Only token present is already exhausted.
    const state = deployState({
      resources: [{ id: rtid('rt-spent'), kind: 'wild', exhausted: true }],
    });
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(
      state,
      deployEngUnit(player.capitalSquare),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_resources');
  });

  it('insufficient_resources: rejects when zero resource tokens at all', () => {
    const state = deployState({ resources: [] });
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(
      state,
      deployEngUnit(player.capitalSquare),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_resources');
  });
});

// ─── needs-confirmation pins ─────────────────────────────────────────
//
// MVP-1 chose interpretations for two underspecified rules. The
// `it.skip` entries below pin the question for Cassian / Jason to
// resolve in a follow-up PR. The current MVP behaviour is asserted
// in the "happy path" and other tests above; THIS block records what
// the alternative behaviour would look like if/when the rulebook
// dictates it.

describe('DeployUnit — needs-confirmation', () => {
  // @needs-confirmation: Can multiple units share the Capital square?
  // Default (MVP): yes. The rulebook may forbid stacking on Capital;
  // until confirmed, we accept it so MVP-1 can ship.
  it.skip('capital-stacking forbidden — second deploy onto occupied capital is rejected', () => {
    const state = deployState({
      hand: ['eng-watchman', 'eng-watchman'],
      resources: [
        { id: rtid('rt-1'), kind: 'wild', exhausted: false },
        { id: rtid('rt-2'), kind: 'wild', exhausted: false },
      ],
    });
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const r1 = applyAction(state, deployEngUnit(player.capitalSquare), SEAT_1);
    if (!r1.ok) throw new Error('first deploy should succeed');
    const r2 = applyAction(r1.value, deployEngUnit(player.capitalSquare), SEAT_1);
    expect(r2.ok).toBe(false);
    // Error code TBD once the rule is confirmed (likely 'square_occupied').
  });

  // @needs-confirmation: Do newly-deployed units enter EXHAUSTED?
  // Default (MVP): no, units start un-exhausted so the player can act
  // with them on the turn they were deployed. Many boardgames forbid
  // this; if the rulebook does, flip the default in the handler.
  it.skip('newly-deployed unit enters exhausted (cannot act same turn)', () => {
    const state = deployState();
    const player = state.players[1];
    if (player === undefined) throw new Error('fixture broken');
    const result = applyAction(
      state,
      deployEngUnit(player.capitalSquare),
      SEAT_1,
    );
    if (!result.ok) throw new Error('deploy should succeed');
    expect(result.value.units[0]?.exhausted).toBe(true);
  });
});
