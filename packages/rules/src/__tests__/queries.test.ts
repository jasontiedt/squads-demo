// ─────────────────────────── queries — MVP-6 S1 (#97) ──────────────
//
// Pure-helper coverage for `packages/rules/src/queries.ts`. Builds
// minimal `GameState` fixtures inline rather than reusing
// `initialState` factories so each test asserts the helper's behavior
// in isolation, not the seeding contract.

import { describe, expect, it } from 'vitest';
import type {
  BuildingInstance,
  BuildingInstanceId,
  CardId,
  Coord,
  GameState,
  Player,
  Seat,
  Seed,
  Tile,
  TileId,
  UnitInstance,
  UnitInstanceId,
} from '@eoe/schema';

import {
  capitalOf,
  tileOfSquare,
  unitsFor,
  unitsOnTile,
} from '../queries.js';

// ─────────────────────────── Fixtures ───────────────────────────────

const cid = (s: string): CardId => s as CardId;
const TEST_SEED = 'queries-seed' as Seed;

function makeTile(id: string, anchor: Coord): Tile {
  // 2×2 tile rooted at `anchor`. Squares cover (x,y), (x+1,y),
  // (x,y+1), (x+1,y+1). Terrain is uniform plain — irrelevant for
  // query helpers.
  return {
    id: id as TileId,
    kind: 'starting',
    orientation: 0,
    faceDown: false,
    squares: [
      { coord: { x: anchor.x, y: anchor.y }, terrain: 'plain' },
      { coord: { x: anchor.x + 1, y: anchor.y }, terrain: 'plain' },
      { coord: { x: anchor.x, y: anchor.y + 1 }, terrain: 'plain' },
      { coord: { x: anchor.x + 1, y: anchor.y + 1 }, terrain: 'plain' },
    ],
  };
}

function makeUnit(
  id: string,
  owner: Seat,
  square: Coord,
  card = 'eng-unit-archer',
): UnitInstance {
  return {
    id: id as UnitInstanceId,
    cardId: cid(card),
    owner,
    square,
    exhausted: false,
    damage: 0,
    attackMode: 'melee',
    upgrades: [],
  };
}

function makeCapital(
  id: string,
  owner: Seat,
  square: Coord,
  tileId: string,
): BuildingInstance {
  return {
    id: id as BuildingInstanceId,
    type: 'capital',
    owner,
    square,
    damage: 0,
    tileId: tileId as TileId,
    siegeState: 'open',
  };
}

function makePlayer(seat: Seat): Player {
  return {
    seat,
    civ: 'english',
    capitalHp: 10,
    capitalSquare: { x: 0, y: 0 },
    hand: [],
    deck: [],
    discard: [],
    resources: [],
    temporaryResources: [],
    activeEvents: [],
    unitField: { kingPawnUsed: false, queenPawnUsed: false },
    civCardId: cid('eng-civ'),
  };
}

/**
 * Two-tile board:
 *   • `t-p1` covers (0,0)..(1,1) — seat-1 capital sits at (0,0).
 *   • `t-p2` covers (4,4)..(5,5) — seat-2 capital sits at (5,5).
 * Several units sprinkled across both tiles plus one out-of-tile unit
 * so `tileOfSquare(undefined)` is exercised.
 */
function makeState(): GameState {
  const u1Tile1 = makeUnit('u1-on-t1', 1, { x: 0, y: 1 });
  const u2Tile1 = makeUnit('u2-on-t1', 2, { x: 1, y: 0 });
  const u3Tile2 = makeUnit('u3-on-t2', 1, { x: 4, y: 5 });
  const u4Tile2 = makeUnit('u4-on-t2', 2, { x: 5, y: 4 });
  const u5Orphan = makeUnit('u5-no-tile', 1, { x: 3, y: 3 }); // not in either tile

  return {
    version: 1,
    gameId: 'GAME-Q',
    seed: TEST_SEED,
    phase: 'mobilization',
    activePlayer: 1,
    turn: 1,
    players: { 1: makePlayer(1), 2: makePlayer(2) },
    units: [u1Tile1, u2Tile1, u3Tile2, u4Tile2, u5Orphan],
    buildings: [
      makeCapital('cap-1', 1, { x: 0, y: 0 }, 't-p1'),
      makeCapital('cap-2', 2, { x: 5, y: 5 }, 't-p2'),
    ],
    map: {
      tiles: [makeTile('t-p1', { x: 0, y: 0 }), makeTile('t-p2', { x: 4, y: 4 })],
    },
    moveLog: [],
  };
}

// ─────────────────────────── unitsFor ───────────────────────────────

describe('unitsFor(state, seat)', () => {
  it('returns only units owned by the requested seat', () => {
    const state = makeState();
    const seat1Units = unitsFor(state, 1);
    expect(seat1Units.map((u) => u.id).sort()).toEqual(
      ['u1-on-t1', 'u3-on-t2', 'u5-no-tile'].sort(),
    );
    for (const u of seat1Units) expect(u.owner).toBe(1);
  });

  it('returns the other seat independently (no leakage)', () => {
    const state = makeState();
    const seat2Units = unitsFor(state, 2);
    expect(seat2Units.map((u) => u.id).sort()).toEqual(
      ['u2-on-t1', 'u4-on-t2'].sort(),
    );
  });

  it('returns an empty array for a seat with no units', () => {
    const state = makeState();
    expect(unitsFor(state, 3)).toEqual([]);
    expect(unitsFor(state, 4)).toEqual([]);
  });

  it('does not mutate state.units', () => {
    const state = makeState();
    const before = [...state.units];
    unitsFor(state, 1);
    expect(state.units).toEqual(before);
  });
});

// ─────────────────────────── tileOfSquare ───────────────────────────

describe('tileOfSquare(state, square)', () => {
  it('resolves an anchor square to its tile', () => {
    const state = makeState();
    expect(tileOfSquare(state, { x: 0, y: 0 })).toBe('t-p1');
    expect(tileOfSquare(state, { x: 5, y: 5 })).toBe('t-p2');
  });

  it('resolves a non-anchor square in the tile', () => {
    const state = makeState();
    expect(tileOfSquare(state, { x: 1, y: 1 })).toBe('t-p1');
    expect(tileOfSquare(state, { x: 4, y: 5 })).toBe('t-p2');
  });

  it('returns undefined for a square not covered by any tile', () => {
    const state = makeState();
    expect(tileOfSquare(state, { x: 3, y: 3 })).toBeUndefined();
    expect(tileOfSquare(state, { x: 2, y: 5 })).toBeUndefined();
  });

  it('returns undefined on an empty map', () => {
    const state: GameState = { ...makeState(), map: { tiles: [] } };
    expect(tileOfSquare(state, { x: 0, y: 0 })).toBeUndefined();
  });
});

// ─────────────────────────── unitsOnTile ────────────────────────────

describe('unitsOnTile(state, tileId)', () => {
  it('returns every unit whose square sits inside the tile', () => {
    const state = makeState();
    const onT1 = unitsOnTile(state, 't-p1' as TileId);
    expect(onT1.map((u) => u.id).sort()).toEqual(
      ['u1-on-t1', 'u2-on-t1'].sort(),
    );
  });

  it('returns units regardless of owner', () => {
    const state = makeState();
    const onT2 = unitsOnTile(state, 't-p2' as TileId);
    const owners = onT2.map((u) => u.owner).sort();
    expect(owners).toEqual([1, 2]);
  });

  it('excludes units whose square does not resolve to any tile', () => {
    const state = makeState();
    const onT1 = unitsOnTile(state, 't-p1' as TileId);
    expect(onT1.find((u) => u.id === 'u5-no-tile')).toBeUndefined();
  });

  it('returns an empty array for an unknown tile id', () => {
    const state = makeState();
    expect(unitsOnTile(state, 't-does-not-exist' as TileId)).toEqual([]);
  });
});

// ─────────────────────────── capitalOf ──────────────────────────────

describe('capitalOf(state, seat)', () => {
  it('returns the capital owned by the seat', () => {
    const state = makeState();
    const cap1 = capitalOf(state, 1);
    expect(cap1?.id).toBe('cap-1');
    expect(cap1?.type).toBe('capital');
    expect(cap1?.owner).toBe(1);
  });

  it('narrows the discriminated union — tileId and siegeState are visible', () => {
    const state = makeState();
    const cap = capitalOf(state, 2);
    // Property access through the narrowed type compiles cleanly; the
    // runtime values come from the fixture.
    expect(cap?.tileId).toBe('t-p2');
    expect(cap?.siegeState).toBe('open');
  });

  it('returns undefined when the seat has no capital on the board', () => {
    const state = makeState();
    expect(capitalOf(state, 3)).toBeUndefined();
    expect(capitalOf(state, 4)).toBeUndefined();
  });

  it('does not accidentally return a non-capital building of the seat', () => {
    const state = makeState();
    const stateWithCamp: GameState = {
      ...state,
      buildings: [
        ...state.buildings,
        {
          id: 'b-camp-1' as BuildingInstanceId,
          type: 'camp',
          owner: 1,
          square: { x: 1, y: 1 },
          damage: 0,
          terrain: 'plain',
        },
      ],
    };
    const cap = capitalOf(stateWithCamp, 1);
    expect(cap?.type).toBe('capital');
    expect(cap?.id).toBe('cap-1');
  });
});
