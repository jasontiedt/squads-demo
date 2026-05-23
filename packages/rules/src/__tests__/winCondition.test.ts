import type {
  Action,
  CardId,
  GameState,
  UnitInstance,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_1 } from './fixtures.js';

// ─────────────────────────── Win condition (Issue #55) ───────────────
//
// MVP-3 #3: when one seated player has zero units after a turn, the
// game ends with the opposing seat as winner.
//
// Gating: `state.units.length > 2` (strictly greater than two). The
// guard prevents instant-end at game start before deployments
// accumulate.
//
// Capital HP win condition is MVP-4 — out of scope.
//
// NOTE (needs-confirmation): the spec example in issue #55 says
// "deploy 1 unit per side, attack-kill, end turn" which would leave
// exactly 1 unit on the board after the kill — failing the `> 2`
// guard. The literal spec text reads ">2", so this implementation
// enforces `> 2` and the tests below match that interpretation. If
// the example was authoritative, the guard should be `>= 1` (i.e.
// any unit has ever been on the board). Flagging for product review.

const cid = (s: string): CardId => s as CardId;
const uid = (s: string): UnitInstance['id'] => s as UnitInstance['id'];

function makeUnit(
  id: string,
  cardId: string,
  owner: 1 | 2,
  square: { x: number; y: number },
  overrides: Partial<UnitInstance> = {},
): UnitInstance {
  return {
    id: uid(id),
    cardId: cid(cardId),
    owner,
    square,
    exhausted: false,
    damage: 0,
    attackMode: 'melee',
    upgrades: [],
    ...overrides,
  };
}

/** Build an end-of-turn state (phase: 'end', active seat 1) with custom units. */
function endTurnState(units: UnitInstance[]): GameState {
  return {
    ...baseState,
    phase: 'end',
    activePlayer: SEAT_1,
    units,
  };
}

const END_TURN: Action = { type: 'EndTurn' };

describe('EndTurn win condition (#55)', () => {
  it('ends the game when seat 2 has zero units and total units > 2', () => {
    // Seat 1 has 3 units, seat 2 has 0. Total = 3, > 2 ⇒ guard passes.
    const units: UnitInstance[] = [
      makeUnit('u-1', 'eng-watchman', 1, { x: 1, y: 0 }),
      makeUnit('u-2', 'eng-longbowman', 1, { x: 0, y: 1 }),
      makeUnit('u-3', 'eng-welsh-infantry', 1, { x: 1, y: 1 }),
    ];
    const state = endTurnState(units);
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('ended');
    expect(result.value.winner).toBe(1);
  });

  it('ends the game when seat 1 has zero units and total units > 2', () => {
    // Seat 2 has 3 units, seat 1 has 0. Total = 3, > 2 ⇒ guard passes.
    const units: UnitInstance[] = [
      makeUnit('u-1', 'byz-varangian-guard', 2, { x: 4, y: 5 }),
      makeUnit('u-2', 'byz-cataphract', 2, { x: 5, y: 4 }),
      makeUnit('u-3', 'byz-cataphract', 2, { x: 4, y: 4 }),
    ];
    const state = endTurnState(units);
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('ended');
    expect(result.value.winner).toBe(2);
  });

  it('does NOT end the game at game start (units = 0, guard blocks)', () => {
    // Pristine state — no units deployed yet. Both players have zero
    // units, but the `> 2` guard prevents instant-end.
    const state = endTurnState([]);
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('start');
    expect(result.value.winner).toBeUndefined();
  });

  it('does NOT end the game when total units ≤ 2 (guard blocks)', () => {
    // Seat 1 has 2 units, seat 2 has 0. Total = 2, NOT > 2 ⇒ guard fails.
    const units: UnitInstance[] = [
      makeUnit('u-1', 'eng-watchman', 1, { x: 1, y: 0 }),
      makeUnit('u-2', 'eng-longbowman', 1, { x: 0, y: 1 }),
    ];
    const state = endTurnState(units);
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('start');
    expect(result.value.winner).toBeUndefined();
  });

  it('does NOT end the game when both players still have units', () => {
    // Seat 1 has 2, seat 2 has 1. Total = 3 > 2, but nobody is wiped.
    const units: UnitInstance[] = [
      makeUnit('u-1', 'eng-watchman', 1, { x: 1, y: 0 }),
      makeUnit('u-2', 'eng-longbowman', 1, { x: 0, y: 1 }),
      makeUnit('u-3', 'byz-cataphract', 2, { x: 5, y: 4 }),
    ];
    const state = endTurnState(units);
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('start');
    expect(result.value.winner).toBeUndefined();
  });

  it('preserves turn rotation when the game ends', () => {
    // Seat 1 ends their turn with seat 2 wiped out. Even though the
    // game ends, rotation/turn fields run first (we just override
    // phase + winner). activePlayer should still advance to seat 2.
    const units: UnitInstance[] = [
      makeUnit('u-1', 'eng-watchman', 1, { x: 1, y: 0 }),
      makeUnit('u-2', 'eng-longbowman', 1, { x: 0, y: 1 }),
      makeUnit('u-3', 'eng-welsh-infantry', 1, { x: 1, y: 1 }),
    ];
    const state = endTurnState(units);
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.activePlayer).toBe(2);
    expect(result.value.phase).toBe('ended');
    expect(result.value.winner).toBe(1);
  });

  it('does not mutate the input state', () => {
    const units: UnitInstance[] = [
      makeUnit('u-1', 'eng-watchman', 1, { x: 1, y: 0 }),
      makeUnit('u-2', 'eng-longbowman', 1, { x: 0, y: 1 }),
      makeUnit('u-3', 'eng-welsh-infantry', 1, { x: 1, y: 1 }),
    ];
    const state = endTurnState(units);
    const snapshot = JSON.stringify(state);

    applyAction(state, END_TURN, SEAT_1);

    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.phase).toBe('end');
    expect(state.winner).toBeUndefined();
  });

  // ─── needs-confirmation ─────────────────────────────────────────────
  // Issue #55 example: "deploy 1 unit per side, attack-kill, end turn,
  // assert phase=ended". After the kill there is 1 unit left on the
  // board (total = 1), which fails the literal `> 2` guard from the
  // same issue. These two statements in the issue contradict each
  // other. Skipping until product confirms the intended guard.
  // If the example is canonical, change the guard from `> 2` to
  // something like `>= 1` (any unit ever on the board) and remove
  // this skip.
  it.skip('[needs-confirmation] ends game from issue-#55 example (1-per-side, kill)', () => {
    // Survivor: seat 1's unit. Seat 2 was killed in mobilization.
    const units: UnitInstance[] = [
      makeUnit('u-1', 'eng-watchman', 1, { x: 1, y: 0 }),
    ];
    const state = endTurnState(units);
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.phase).toBe('ended');
    expect(result.value.winner).toBe(1);
  });
});

describe('Ended phase blocks all actions (#55)', () => {
  it('rejects EndTurn from an already-ended game', () => {
    const state: GameState = {
      ...baseState,
      phase: 'ended',
      winner: 1,
    };
    const result = applyAction(state, END_TURN, SEAT_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });

  it('rejects EndPhase from an already-ended game', () => {
    const state: GameState = {
      ...baseState,
      phase: 'ended',
      winner: 2,
    };
    const result = applyAction(state, { type: 'EndPhase' }, SEAT_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });
});
