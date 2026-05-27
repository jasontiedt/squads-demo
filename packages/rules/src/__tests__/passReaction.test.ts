import {
  type Action,
  type CardId,
  type GameState,
  type Player,
  type Seat,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

const cid = (s: string): CardId => s as CardId;

const passReaction = (): Action =>
  ({ type: 'PassReaction' }) as unknown as Action;

// Build a state with an open reaction window. activePlayer is SEAT_1
// (from baseState), eligible seat is SEAT_2 by default.
function windowState(eligibleSeat: Seat = SEAT_2): GameState {
  return {
    ...baseState,
    pendingReactionWindow: {
      trigger: { kind: 'on-attack-declared' },
      triggerContext: {},
      eligibleSeat,
    },
  };
}

describe('PassReaction — issue #101', () => {
  it('happy path: closes the window, state otherwise unchanged', () => {
    const before = windowState();
    // Snapshot everything except pendingReactionWindow so we can prove
    // nothing else moved.
    const snapshot = JSON.parse(JSON.stringify({
      ...before,
      pendingReactionWindow: undefined,
    }));

    const result = applyAction(before, passReaction(), SEAT_2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingReactionWindow).toBeUndefined();
    // Players, units, buildings, log, phase, activePlayer all unchanged.
    const afterMinusWindow = JSON.parse(JSON.stringify({
      ...result.value,
      pendingReactionWindow: undefined,
    }));
    expect(afterMinusWindow).toEqual(snapshot);
  });

  it('no_window_open: no pendingReactionWindow → err', () => {
    const before: GameState = { ...baseState };
    // SEAT_2 is the non-active seat → passes the opponent-turn gate.
    const result = applyAction(before, passReaction(), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no_window_open');
  });

  it('not_eligible_seat: window targets SEAT_1, SEAT_2 attempts to pass → err', () => {
    // Window's eligibleSeat = SEAT_1, but SEAT_2 (the non-active seat)
    // tries to pass. Seat-gate passes (SEAT_2 isn't activePlayer); the
    // eligibility check in passReaction rejects.
    const before = windowState(SEAT_1);
    const result = applyAction(before, passReaction(), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_eligible_seat');
  });

  it('not_your_turn: active seat attempts to pass → err (seat gate)', () => {
    // SEAT_1 is activePlayer; PassReaction is an opponent-turn action.
    const before = windowState();
    const result = applyAction(before, passReaction(), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });

  it('preserves resources: no cost is paid', () => {
    const reactor = baseState.players[SEAT_2];
    if (reactor === undefined) throw new Error('fixture invariant');
    const newReactor: Player = {
      ...reactor,
      resources: [
        { id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false },
      ],
    };
    const before: GameState = {
      ...windowState(),
      players: { ...baseState.players, [SEAT_2]: newReactor },
    };

    const result = applyAction(before, passReaction(), SEAT_2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.players[SEAT_2];
    expect(after?.resources[0]?.exhausted).toBe(false);
  });
});
