import type { Action, GameState, Tile, TileId } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { scout } from '../scout.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

// ─────────────────────────── Scout (Issue #56) ───────────────────────
//
// MVP-3: pure reveal of a face-down tile. No adjacency, no cost, no
// per-turn cap. Tests cover happy path, both rejection codes, and
// upstream gate (wrong phase / not your turn).
//
// `baseState` already has two face-UP starting tiles. We splice a
// face-down tile in for the happy path / already-revealed cases, and
// target an empty coord for the not-found case.

// ─── Fixture helpers ─────────────────────────────────────────────────

/** Face-down highland tile at coords (2,2) (2,3) (3,2) (3,3). */
const faceDownTile: Tile = {
  id: 't-highland-1' as TileId,
  kind: 'highland',
  orientation: 0,
  faceDown: true,
  squares: [
    { coord: { x: 2, y: 2 }, terrain: 'plain' },
    { coord: { x: 3, y: 2 }, terrain: 'forest' },
    { coord: { x: 2, y: 3 }, terrain: 'mountain' },
    { coord: { x: 3, y: 3 }, terrain: 'plain' },
  ],
};

/**
 * Build a scout-ready state: phase `mobilization`, active seat 1, with
 * `faceDownTile` appended to the map. Tests can override `phase` /
 * `activePlayer` per case.
 */
function scoutState(
  patch: Partial<Pick<GameState, 'phase' | 'activePlayer'>> = {},
): GameState {
  return {
    ...baseState,
    phase: 'mobilization',
    activePlayer: SEAT_1,
    map: { tiles: [...baseState.map.tiles, faceDownTile] },
    ...patch,
  };
}

const scoutAction = (target: { x: number; y: number }): Action =>
  ({
    type: 'Scout',
    unitId: 'u-eng-scout-1' as Action extends { type: 'Scout'; unitId: infer U } ? U : never,
    target,
  }) as unknown as Action;

// ─── Happy path ──────────────────────────────────────────────────────

describe('Scout — happy path', () => {
  it('reveals a face-down tile (faceDown flipped to false on the target)', () => {
    const state = scoutState();
    const result = applyAction(state, scoutAction({ x: 2, y: 2 }), SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const target = result.value.map.tiles.find((t) => t.id === 't-highland-1');
    expect(target).toBeDefined();
    expect(target?.faceDown).toBe(false);
  });

  it('reveals when the target coord is any square in the face-down tile, not just (2,2)', () => {
    const state = scoutState();
    // Use a different square in the same tile — (3,3).
    const result = applyAction(state, scoutAction({ x: 3, y: 3 }), SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = result.value.map.tiles.find((t) => t.id === 't-highland-1');
    expect(target?.faceDown).toBe(false);
  });

  it('does not mutate the input state', () => {
    const state = scoutState();
    const before = structuredClone(state);
    applyAction(state, scoutAction({ x: 2, y: 2 }), SEAT_1);
    expect(state).toEqual(before);
  });

  it('preserves state.version (rules engine never bumps; Worker does)', () => {
    const state = { ...scoutState(), version: 7 };
    const result = applyAction(state, scoutAction({ x: 2, y: 2 }), SEAT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(7);
  });

  it('preserves the other tiles (revealed face-up starting tiles unchanged)', () => {
    const state = scoutState();
    const result = applyAction(state, scoutAction({ x: 2, y: 2 }), SEAT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engStart = result.value.map.tiles.find((t) => t.id === 't-eng-start');
    const byzStart = result.value.map.tiles.find((t) => t.id === 't-byz-start');
    expect(engStart?.faceDown).toBe(false);
    expect(byzStart?.faceDown).toBe(false);
  });
});

// ─── Rejections ──────────────────────────────────────────────────────

describe('Scout — rejections', () => {
  it('rejects when the target tile is already revealed (tile_already_revealed)', () => {
    const state = scoutState();
    // (0,0) sits in the english starting tile, which is faceDown:false.
    const result = applyAction(state, scoutAction({ x: 0, y: 0 }), SEAT_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('tile_already_revealed');
  });

  it('rejects when no tile contains the target coord (tile_not_found)', () => {
    const state = scoutState();
    // No tile covers (5,0).
    const result = applyAction(state, scoutAction({ x: 5, y: 0 }), SEAT_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('tile_not_found');
  });

  it('rejects from the wrong phase (wrong_phase, via applyAction gate)', () => {
    const state = scoutState({ phase: 'deployment' });
    const result = applyAction(state, scoutAction({ x: 2, y: 2 }), SEAT_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });

  it('rejects from the wrong seat (not_your_turn, via applyAction gate)', () => {
    const state = scoutState(); // active seat is 1
    const result = applyAction(state, scoutAction({ x: 2, y: 2 }), SEAT_2);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_your_turn');
  });
});

// ─── Handler-direct (bypass applyAction gate) ────────────────────────
//
// A few direct-call tests for completeness — handler should refuse with
// the same codes regardless of how it's invoked.

describe('Scout — handler direct', () => {
  it('returns tile_not_found for an off-map coord', () => {
    const state = scoutState();
    const action = scoutAction({ x: 5, y: 0 }) as Extract<Action, { type: 'Scout' }>;
    const result = scout(state, action, SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('tile_not_found');
  });

  it('returns tile_already_revealed for a face-up tile coord', () => {
    const state = scoutState();
    const action = scoutAction({ x: 0, y: 0 }) as Extract<Action, { type: 'Scout' }>;
    const result = scout(state, action, SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('tile_already_revealed');
  });
});
