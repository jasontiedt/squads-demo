import { ACTION_TYPES, type Action, type ActionType, type TurnPhase } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { ACTION_PHASE_LEGALITY, isOpponentTurnAction } from '../phases.js';
import { applyAction } from '../applyAction.js';
import { ALL_PHASES, SEAT_1, SEAT_2, withState } from './fixtures.js';

// ─────────────────────────── Phase gate exhaustiveness ───────────────
//
// Table-driven coverage: every (ActionType × TurnPhase) pair, sourced
// from the schema's `ACTION_TYPES` tuple. If a new variant lands, the
// loop picks it up automatically — no test list to keep in sync.
//
// Strategy:
//   - Build a minimal valid `Action` payload per type (the gate only
//     reads `action.type`, so empty-bodied stubs cast to `Action` are
//     enough for gating tests; effect-level tests will use full
//     parses in later issues).
//   - For each phase, assert that the rules engine either:
//       a) returns `ok` (or `not_implemented` — gate passed), or
//       b) returns `wrong_phase` if the table says the action is not
//          allowed in that phase.
//   - Reactions (`PlayReaction`) skip phase checks entirely; they're
//     tested separately for the active-seat axis.

function stubAction(type: ActionType): Action {
  // The gate only inspects `action.type`. We deliberately bypass Zod
  // parsing here — the goal is to test gating, not parsing. A few
  // implemented handlers read required fields, so we include minimal
  // payload for those action shapes.
  if (type === 'RecruitDraw') {
    return { type, payload: { count: 1 } } as unknown as Action;
  }
  return { type } as unknown as Action;
}

describe('ACTION_PHASE_LEGALITY table', () => {
  it('covers every action type from @eoe/schema', () => {
    for (const t of ACTION_TYPES) {
      expect(ACTION_PHASE_LEGALITY[t]).toBeDefined();
      expect(ACTION_PHASE_LEGALITY[t].length).toBeGreaterThan(0);
    }
  });

  it('every entry references a known phase or "opponent-turn"', () => {
    const knownPhases: ReadonlyArray<TurnPhase | 'opponent-turn'> = [
      ...ALL_PHASES,
      'opponent-turn',
    ];
    for (const t of ACTION_TYPES) {
      for (const p of ACTION_PHASE_LEGALITY[t]) {
        expect(knownPhases).toContain(p);
      }
    }
  });
});

describe('applyAction phase gate (table-driven)', () => {
  for (const actionType of ACTION_TYPES) {
    // Reactions live on a different axis — covered below.
    if (isOpponentTurnAction(actionType)) continue;

    for (const phase of ALL_PHASES) {
      const legal = ACTION_PHASE_LEGALITY[actionType].includes(phase);
      const label = `${actionType} in ${phase} → ${legal ? 'gate passes' : 'wrong_phase'}`;

      it(label, () => {
        const state = withState({ phase });
        const result = applyAction(state, stubAction(actionType), SEAT_1);

        if (legal) {
          // Gate passed. Either the action is implemented (EndPhase /
          // EndTurn) and returns ok, or it's stubbed and returns
          // `not_implemented`. Both are valid "gate passed" outcomes.
          if (result.ok) {
            expect(result.value).toBeDefined();
          } else {
            expect(result.error.code).not.toBe('wrong_phase');
            expect(result.error.code).not.toBe('not_your_turn');
          }
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe('wrong_phase');
            expect(result.error.message).toContain(actionType);
            expect(result.error.message).toContain(phase);
          }
        }
      });
    }
  }
});

describe('applyAction seat gate', () => {
  it('rejects active-turn action from the non-active seat', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const result = applyAction(state, stubAction('MoveUnit'), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_your_turn');
    }
  });

  it('rejects reaction from the active seat', () => {
    const state = withState({ phase: 'mobilization', activePlayer: 1 });
    const result = applyAction(state, stubAction('PlayReaction'), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_your_turn');
    }
  });

  it('accepts reaction from the non-active seat regardless of phase', () => {
    for (const phase of ALL_PHASES) {
      const state = withState({ phase, activePlayer: 1 });
      const result = applyAction(state, stubAction('PlayReaction'), SEAT_2);
      // Gate passes — handler then sees no open window and returns
      // `no_window_open` (issue #101). Previously was `not_implemented`.
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('no_window_open');
      }
    }
  });
});
