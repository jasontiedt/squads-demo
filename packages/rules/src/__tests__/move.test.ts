import type {
  Action,
  CardId,
  GameState,
  Tile,
  UnitInstance,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { chebyshev, move } from '../move.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

// ─────────────────────────── Move (Issue #67) ────────────────────────
//
// MVP-4 #1: a unit walks across the 6×6 board, blocked by terrain,
// occupied squares, and face-down tiles. See `move.ts` header for the
// full preconditions list.
//
// Real catalog cards used (see packages/assets-meta/data/*):
//   - eng-watchman      (movement.points 2)
//   - eng-hobelar       (movement.points 3 — playtest stub)
//   - byz-cataphract    (movement.points 2)
//
// Move is legal during `mobilization` phase only (see phases.ts) — the
// issue body says "deployment" but the canonical table puts Move with
// the other board actions in `mobilization`.

const cid = (s: string): CardId => s as CardId;
const uid = (s: string): UnitInstance['id'] => s as UnitInstance['id'];

// ─── Test helpers ────────────────────────────────────────────────────

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

/**
 * Build a "wide open" board: a single 6×6 tile of plains so the unit
 * has somewhere to walk. Tile carries 36 squares; `kind: 'starting'` is
 * fine for tests (kind isn't consulted by the move handler).
 */
function plainsBoardTile(): Tile {
  const squares: Tile['squares'] = [] as unknown as Tile['squares'];
  // Build a 4-square tile that covers (0..1, 0..1) and rely on extra
  // tiles below to cover the rest of the board.
  return {
    id: 't-plains-0',
    kind: 'starting',
    orientation: 0,
    faceDown: false,
    squares: [
      { coord: { x: 0, y: 0 }, terrain: 'plain' },
      { coord: { x: 1, y: 0 }, terrain: 'plain' },
      { coord: { x: 0, y: 1 }, terrain: 'plain' },
      { coord: { x: 1, y: 1 }, terrain: 'plain' },
    ],
  };
}

/**
 * Build a Tile covering an arbitrary 2×2 region. `Tile.squares` is
 * pinned to `.length(4)` by the schema, so we keep all custom tiles
 * 2×2. Caller chooses terrain per square so terrain-block tests can
 * drop water/mountain anywhere.
 */
function tileAt(
  id: string,
  origin: { x: number; y: number },
  terrains: readonly [string, string, string, string],
  opts: { faceDown?: boolean } = {},
): Tile {
  return {
    id,
    kind: 'starting',
    orientation: 0,
    faceDown: opts.faceDown ?? false,
    squares: [
      { coord: { x: origin.x, y: origin.y }, terrain: terrains[0] as Tile['squares'][number]['terrain'] },
      { coord: { x: origin.x + 1, y: origin.y }, terrain: terrains[1] as Tile['squares'][number]['terrain'] },
      { coord: { x: origin.x, y: origin.y + 1 }, terrain: terrains[2] as Tile['squares'][number]['terrain'] },
      { coord: { x: origin.x + 1, y: origin.y + 1 }, terrain: terrains[3] as Tile['squares'][number]['terrain'] },
    ],
  };
}

/** Convenience: an all-plains 2×2 tile at the given origin. */
const plainsTile = (id: string, origin: { x: number; y: number }) =>
  tileAt(id, origin, ['plain', 'plain', 'plain', 'plain']);

/**
 * Build a move-ready state: phase `mobilization`, active seat 1, with
 * caller-supplied units + tiles. Tiles override `baseState.map.tiles`
 * so each test can dial terrain precisely.
 */
function moveState(
  units: UnitInstance[],
  tiles: Tile[],
  patch: Partial<Pick<GameState, 'phase' | 'activePlayer'>> = {},
): GameState {
  return {
    ...baseState,
    phase: 'mobilization',
    activePlayer: SEAT_1,
    units,
    map: { tiles },
    ...patch,
  };
}

const moveAction = (
  unitId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Action =>
  ({
    type: 'MoveUnit',
    unitId: uid(unitId),
    from,
    to,
  }) as unknown as Action;

// ─── Helper: chebyshev ───────────────────────────────────────────────

describe('chebyshev helper', () => {
  it('returns 0 for the same coord', () => {
    expect(chebyshev({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
  it('returns max(|dx|, |dy|) — diagonal = orthogonal', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    expect(chebyshev({ x: 0, y: 0 }, { x: 0, y: 3 })).toBe(3);
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
    expect(chebyshev({ x: 0, y: 0 }, { x: 2, y: 3 })).toBe(3);
  });
});

// ─── Happy path ──────────────────────────────────────────────────────

describe('Move — happy path', () => {
  it('moves a unit one square orthogonally within movement.points', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.value.units.find((u) => u.id === uid('u-eng-1'));
    expect(moved?.square).toEqual({ x: 1, y: 0 });
    expect(moved?.exhausted).toBe(true);
  });

  it('moves a unit diagonally — same cost as orthogonal (Chebyshev)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 1 }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.units[0]?.square).toEqual({ x: 1, y: 1 });
  });

  it('moves a Hobelar 3 squares (movement.points = 3)', () => {
    const unit = makeUnit('u-eng-1', 'eng-hobelar', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [
        plainsTile('t1', { x: 0, y: 0 }),
        plainsTile('t2', { x: 2, y: 0 }),
      ],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 3, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
  });

  it('does not bump state.version (Worker is responsible)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(state.version);
  });
});

// ─── Range limit ─────────────────────────────────────────────────────

describe('Move — range limit', () => {
  it('rejects when distance exceeds movement.points (out_of_range)', () => {
    // Watchman mov=2; try to walk 3 squares.
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [
        plainsTile('t1', { x: 0, y: 0 }),
        plainsTile('t2', { x: 2, y: 0 }),
      ],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 3, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_range');
  });

  it('rejects a zero-distance move (to === from)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 0, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
  });
});

// ─── Terrain block ───────────────────────────────────────────────────

describe('Move — terrain block', () => {
  it('rejects moving onto water (illegal_move)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [tileAt('t1', { x: 0, y: 0 }, ['plain', 'water', 'plain', 'plain'])],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
    expect(result.error.message).toMatch(/water/);
  });

  it('rejects moving onto mountain (illegal_move)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [tileAt('t1', { x: 0, y: 0 }, ['plain', 'plain', 'mountain', 'plain'])],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 0, y: 1 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
    expect(result.error.message).toMatch(/mountain/);
  });

  it('rejects moving onto a face-down tile (illegal_move)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [
        plainsTile('t1', { x: 0, y: 0 }),
        tileAt(
          't-hidden',
          { x: 2, y: 0 },
          ['plain', 'plain', 'plain', 'plain'],
          { faceDown: true },
        ),
      ],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 2, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
    expect(result.error.message).toMatch(/face-down/);
  });

  it('rejects moving onto a coord with no tile (off-board)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      // Only the origin tile exists; destination (1,0) is covered too,
      // but (2,0) has no tile.
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 2, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
  });
});

// ─── Occupied block ──────────────────────────────────────────────────

describe('Move — occupied block', () => {
  it('rejects moving onto a friendly unit (illegal_move)', () => {
    const mover = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const friend = makeUnit('u-eng-2', 'eng-watchman', 1, { x: 1, y: 0 });
    const state = moveState(
      [mover, friend],
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
    expect(result.error.message).toMatch(/occupied/);
  });

  it('rejects moving onto an enemy unit (illegal_move — no auto-attack)', () => {
    const mover = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const enemy = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 1, y: 0 });
    const state = moveState(
      [mover, enemy],
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
    expect(result.error.message).toMatch(/occupied/);
  });
});

// ─── Exhaustion gate ─────────────────────────────────────────────────

describe('Move — exhaustion gate', () => {
  it('rejects a unit that has already acted this turn (unit_exhausted)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 }, {
      exhausted: true,
    });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );

    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unit_exhausted');
  });

  it('marks the unit exhausted after a successful move (one action/turn)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );
    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Second move on the same turn must fail.
    const second = applyAction(
      result.value,
      moveAction('u-eng-1', { x: 1, y: 0 }, { x: 1, y: 1 }),
      SEAT_1,
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('unit_exhausted');
  });
});

// ─── Ownership / unit lookup ─────────────────────────────────────────

describe('Move — actor validation', () => {
  it('rejects when unit is not on the board (unit_not_found)', () => {
    const state = moveState([], [plainsTile('t1', { x: 0, y: 0 })]);
    const result = applyAction(
      state,
      moveAction('u-ghost', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unit_not_found');
  });

  it('rejects when unit belongs to a different seat (unit_not_yours)', () => {
    // Active player is SEAT_1 but the moved unit is owned by SEAT_2.
    const unit = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );
    const result = applyAction(
      state,
      moveAction('u-byz-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unit_not_yours');
  });

  it('rejects when action.from disagrees with the unit\'s actual square', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 1, y: 1 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );
    // Lie about origin — claim (0,0) when unit is actually at (1,1).
    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('illegal_move');
  });
});

// ─── Phase / seat gates ──────────────────────────────────────────────

describe('Move — phase + seat gating', () => {
  it('rejects during deployment phase (wrong_phase)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
      { phase: 'deployment' },
    );
    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });

  it('rejects during start phase (wrong_phase)', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
      { phase: 'start' },
    );
    const result = applyAction(
      state,
      moveAction('u-eng-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });

  it('rejects when actor is not the active seat (not_your_turn)', () => {
    const unit = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 0 });
    // activePlayer stays at SEAT_1 (the moveState default).
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );
    const result = applyAction(
      state,
      moveAction('u-byz-1', { x: 0, y: 0 }, { x: 1, y: 0 }),
      SEAT_2,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_your_turn');
  });
});

// ─── Direct handler smoke test ───────────────────────────────────────

describe('move (direct handler call)', () => {
  it('is callable bypassing applyAction', () => {
    const unit = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = moveState(
      [unit],
      [plainsTile('t1', { x: 0, y: 0 })],
    );
    const result = move(
      state,
      {
        type: 'MoveUnit',
        unitId: uid('u-eng-1'),
        from: { x: 0, y: 0 },
        to: { x: 1, y: 0 },
      } as unknown as Extract<Action, { type: 'MoveUnit' }>,
      SEAT_1,
    );
    expect(result.ok).toBe(true);
  });
});
