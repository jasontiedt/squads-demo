import type { Action } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { SEAT_1, SEAT_2, baseState, withState } from './fixtures.js';

// ─────────────────────────── applyAction: phase + turn machine ───────
//
// Covers the two actions that have real effect logic in issue #6:
// `EndPhase` (intra-turn phase progression) and `EndTurn` (seat
// rotation + turn counter + cleanup hook).

const endPhase: Action = { type: 'EndPhase' } as unknown as Action;
const endTurn: Action = { type: 'EndTurn' } as unknown as Action;

describe('EndPhase progression', () => {
  it('start → mobilization', () => {
    const state = withState({ phase: 'start' });
    const result = applyAction(state, endPhase, SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phase).toBe('mobilization');
      // Active seat and turn must NOT change on intra-turn EndPhase.
      expect(result.value.activePlayer).toBe(state.activePlayer);
      expect(result.value.turn).toBe(state.turn);
    }
  });

  it('mobilization → deployment', () => {
    const state = withState({ phase: 'mobilization' });
    const result = applyAction(state, endPhase, SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.phase).toBe('deployment');
  });

  it('deployment → end', () => {
    const state = withState({ phase: 'deployment' });
    const result = applyAction(state, endPhase, SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.phase).toBe('end');
  });

  it('from end → wrong_phase (must use EndTurn)', () => {
    const state = withState({ phase: 'end' });
    const result = applyAction(state, endPhase, SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('does not mutate the input state', () => {
    const state = withState({ phase: 'start' });
    const snapshot = JSON.stringify(state);
    applyAction(state, endPhase, SEAT_1);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe('EndTurn seat rotation', () => {
  it('only legal from the end phase', () => {
    for (const phase of ['start', 'mobilization', 'deployment'] as const) {
      const state = withState({ phase });
      const result = applyAction(state, endTurn, SEAT_1);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('wrong_phase');
    }
  });

  it('seat 1 → seat 2, phase resets to start, turn unchanged (no wrap)', () => {
    const state = withState({ phase: 'end', activePlayer: 1, turn: 1 });
    const result = applyAction(state, endTurn, SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.activePlayer).toBe(2);
      expect(result.value.phase).toBe('start');
      expect(result.value.turn).toBe(1);
    }
  });

  it('seat 2 → seat 1, turn increments on wrap (2-player game)', () => {
    const state = withState({ phase: 'end', activePlayer: 2, turn: 1 });
    const result = applyAction(state, endTurn, SEAT_2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.activePlayer).toBe(1);
      expect(result.value.phase).toBe('start');
      // Wrapped past seat 1 → turn counter ticks.
      expect(result.value.turn).toBe(2);
    }
  });

  it('rejects when actor is not the active seat', () => {
    const state = withState({ phase: 'end', activePlayer: 1 });
    const result = applyAction(state, endTurn, SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });

  it('does not mutate the input state', () => {
    const state = withState({ phase: 'end', activePlayer: 1, turn: 1 });
    const snapshot = JSON.stringify(state);
    applyAction(state, endTurn, SEAT_1);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('full two-player round-trip lands back on seat 1 with turn=2', () => {
    // Seat 1: start → mob → dep → end → EndTurn → seat 2 / turn 1 / start
    // Seat 2: start → mob → dep → end → EndTurn → seat 1 / turn 2 / start
    let state = baseState;
    expect(state.phase).toBe('start');
    expect(state.activePlayer).toBe(1);
    expect(state.turn).toBe(1);

    const advance = (actor: typeof SEAT_1 | typeof SEAT_2): void => {
      for (const _ of [0, 1, 2]) {
        const r = applyAction(state, endPhase, actor);
        if (!r.ok) throw new Error(`unexpected: ${r.error.code} ${r.error.message}`);
        state = r.value;
      }
      const r = applyAction(state, endTurn, actor);
      if (!r.ok) throw new Error(`unexpected: ${r.error.code} ${r.error.message}`);
      state = r.value;
    };

    advance(SEAT_1);
    expect(state.activePlayer).toBe(2);
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('start');

    advance(SEAT_2);
    expect(state.activePlayer).toBe(1);
    expect(state.turn).toBe(2);
    expect(state.phase).toBe('start');
  });
});
