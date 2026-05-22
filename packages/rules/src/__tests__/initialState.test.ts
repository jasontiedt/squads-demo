// ─────────────────────────── initialState — #57 ────────────────────
//
// Verifies the pure construction contract for new-game state:
//   • round-trips cleanly through `GameState.parse()`
//   • each player has exactly one capital BuildingInstance on their
//     starting tile, with HP = CAPITAL_DEFAULT_HP and damage = 0
//   • capital ids match the documented convention (bld-cap-p1/p2)
//   • `units` starts empty
//   • starting tiles are face-up (faceDown=false) so units can deploy
//   • placement is deterministic: player 1 = tiles[0], player 2 = last
//   • same `(gameCode, seed, civ)` inputs produce identical state
//   • input state is never mutated by `addJoiner`

import { describe, expect, it } from 'vitest';
import {
  type BuildingInstance,
  type Coord,
  GameState,
  type Seed,
  type Tile,
} from '@eoe/schema';
import { CAPITAL_DEFAULT_HP } from '../constants.js';
import { addJoiner, buildCreatorState } from '../initialState.js';

const TEST_SEED = 'deadbeef' as Seed;

/** True iff `square` is one of the four squares making up `tile`. */
function tileContains(tile: Tile, square: Coord): boolean {
  return tile.squares.some(
    (s) => s.coord.x === square.x && s.coord.y === square.y,
  );
}

function capitalsOf(state: GameState): readonly BuildingInstance[] {
  return state.buildings.filter((b) => b.type === 'capital');
}

describe('buildCreatorState — seat-1-only initial state', () => {
  it('round-trips through GameState.parse', () => {
    const state = buildCreatorState('GAME01', TEST_SEED, 'english');
    expect(() => GameState.parse(state)).not.toThrow();
  });

  it('places exactly one capital for seat 1 with default HP and zero damage', () => {
    const state = buildCreatorState('GAME01', TEST_SEED, 'english');
    const capitals = capitalsOf(state);
    expect(capitals).toHaveLength(1);
    expect(capitals[0]?.owner).toBe(1);
    expect(capitals[0]?.id).toBe('bld-cap-p1');
    expect(capitals[0]?.damage).toBe(0);
    expect(state.players[1]?.capitalHp).toBe(CAPITAL_DEFAULT_HP);
  });

  it('places the seat-1 capital on the seat-1 starting tile (tiles[0])', () => {
    const state = buildCreatorState('GAME01', TEST_SEED, 'english');
    const cap = capitalsOf(state)[0]!;
    const firstTile = state.map.tiles[0]!;
    expect(tileContains(firstTile, cap.square)).toBe(true);
  });

  it('starts with empty units[]', () => {
    const state = buildCreatorState('GAME01', TEST_SEED, 'english');
    expect(state.units).toEqual([]);
  });

  it('reveals (faceDown=false) the seat-1 starting tile', () => {
    const state = buildCreatorState('GAME01', TEST_SEED, 'english');
    expect(state.map.tiles[0]?.faceDown).toBe(false);
  });

  it('uses phase=start, turn=1, activePlayer=1, version=1', () => {
    const state = buildCreatorState('GAME01', TEST_SEED, 'english');
    expect(state.phase).toBe('start');
    expect(state.turn).toBe(1);
    expect(state.activePlayer).toBe(1);
    expect(state.version).toBe(1);
  });

  it('is deterministic for identical (gameCode, seed, civ) inputs', () => {
    const a = buildCreatorState('GAME01', TEST_SEED, 'english');
    const b = buildCreatorState('GAME01', TEST_SEED, 'english');
    expect(a).toEqual(b);
  });
});

describe('addJoiner — fold seat 2 into an existing state', () => {
  it('adds a seat-2 capital with default HP, zero damage, and id bld-cap-p2', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const joined = addJoiner(created, 'byzantines');

    const capitals = capitalsOf(joined);
    expect(capitals).toHaveLength(2);
    const seat2Cap = capitals.find((c) => c.owner === 2);
    expect(seat2Cap).toBeDefined();
    expect(seat2Cap?.id).toBe('bld-cap-p2');
    expect(seat2Cap?.damage).toBe(0);
    expect(joined.players[2]?.capitalHp).toBe(CAPITAL_DEFAULT_HP);
  });

  it('places the seat-2 capital on the last starting tile (tiles[length-1])', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const joined = addJoiner(created, 'byzantines');
    const seat2Cap = capitalsOf(joined).find((c) => c.owner === 2)!;
    const lastTile = joined.map.tiles[joined.map.tiles.length - 1]!;
    expect(tileContains(lastTile, seat2Cap.square)).toBe(true);
  });

  it('round-trips through GameState.parse with both players populated', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const joined = addJoiner(created, 'byzantines');
    expect(() => GameState.parse(joined)).not.toThrow();
    expect(joined.players[1]).toBeDefined();
    expect(joined.players[2]).toBeDefined();
  });

  it('keeps units[] empty after seat 2 joins', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const joined = addJoiner(created, 'byzantines');
    expect(joined.units).toEqual([]);
  });

  it('reveals both starting tiles (faceDown=false)', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const joined = addJoiner(created, 'byzantines');
    expect(joined.map.tiles).toHaveLength(2);
    for (const tile of joined.map.tiles) {
      expect(tile.faceDown).toBe(false);
    }
  });

  it('bumps version (1 → 2)', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const joined = addJoiner(created, 'byzantines');
    expect(created.version).toBe(1);
    expect(joined.version).toBe(2);
  });

  it('flags seat 2 with firstPlayerSecondPlayerWild=true and leaves seat 1 unflagged', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const joined = addJoiner(created, 'byzantines');
    expect(joined.players[1]?.firstPlayerSecondPlayerWild).toBeUndefined();
    expect(joined.players[2]?.firstPlayerSecondPlayerWild).toBe(true);
  });

  it('does not mutate the input state', () => {
    const created = buildCreatorState('GAME02', TEST_SEED, 'english');
    const snapshot = structuredClone(created);
    addJoiner(created, 'byzantines');
    expect(created).toEqual(snapshot);
  });
});
