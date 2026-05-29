// ─────────────────────────── queries.ts (MVP-6 S1, issue #97) ───────
//
// Pure, read-only helpers over `GameState`. Foundation slice — S3
// (`effectiveStats` walking per-seat units for class-wide passives),
// S4 (Event handlers asking which units sit on a given tile), and S5
// (Reaction trigger metadata: "which tile did this attack target?")
// all need these. Without them, four handlers reinvent the same
// iterate-filter idioms.
//
// RFC: `.squad/decisions/inbox/wedge-capital-units-shape.md` (folded
// into MVP-6 S1 — see `wedge-mvp6-scope.md`).
//
// Determinism contract: no I/O, no RNG, no `Date.now`. Helpers return
// `readonly` arrays so callers can't mutate engine state through them.
// `state` is treated as immutable input — never mutated.

import type { Coord, GameState, Seat, TileId, UnitInstance } from '@eoe/schema';

import type { CapitalInstance } from '@eoe/schema';

const BARRACKS_DEPLOY_HP = 1;
const coordKey = (square: Coord): string => `${square.x},${square.y}`;

type DeployStateLike = Pick<GameState, 'map' | 'buildings'> & {
  readonly players: Partial<Record<Seat, { readonly capitalSquare: Coord } | undefined>>;
};

// ─────────────────────────── unitsFor ───────────────────────────────

/**
 * All units owned by `seat`. O(units). Use for "all your units" effects
 * (heal-all, class-wide passive application) and for trigger metadata
 * that needs the seat's roster (Reactions watching "any unit you own").
 *
 * Returns a `readonly` slice — callers MUST treat results as immutable.
 */
export function unitsFor(state: GameState, seat: Seat): readonly UnitInstance[] {
  return state.units.filter((u) => u.owner === seat);
}

// ─────────────────────────── tileOfSquare ───────────────────────────

/**
 * Reverse lookup: given a board-flat `Coord`, return the id of the
 * containing tile, or `undefined` if no tile covers that square.
 *
 * O(tiles × 4) — at MVP scale (≤ ~9 tiles × 4 squares = 36 entries)
 * this is fixed and cheap. Used by `unitsOnTile` and by the initial-
 * state factory to seed `CapitalInstance.tileId`.
 */
export function tileOfSquare(state: Pick<GameState, 'map'>, square: Coord): TileId | undefined {
  for (const tile of state.map.tiles) {
    for (const s of tile.squares) {
      if (s.coord.x === square.x && s.coord.y === square.y) {
        return tile.id;
      }
    }
  }
  return undefined;
}

// ─────────────────────────── unitsOnTile ────────────────────────────

/**
 * All units whose `square` falls inside the tile identified by `tileId`.
 * O(units × tiles × 4). Use for Event handlers that target "every unit
 * on this tile" and for Reaction triggers that need to know which units
 * occupy a sieged capital's tile.
 *
 * Units whose square does not resolve to any tile (which should not
 * happen for parsed states — every unit sits on a board square covered
 * by a tile) are silently excluded. Returns a `readonly` slice.
 */
export function unitsOnTile(state: GameState, tileId: TileId): readonly UnitInstance[] {
  return state.units.filter((u) => tileOfSquare(state, u.square) === tileId);
}

// ─────────────────────────── capitalOf ──────────────────────────────

/**
 * The `CapitalInstance` owned by `seat`, or `undefined` if the seat has
 * no capital on the board (defensive — every player has exactly one
 * capital seeded at game start; absence means an unseated slot).
 *
 * O(buildings). The type predicate narrows the discriminated-union
 * `BuildingInstance` down to `CapitalInstance` for callers — `tileId`,
 * `siegeState`, etc. are visible without re-narrowing.
 */
export function capitalOf(state: GameState, seat: Seat): CapitalInstance | undefined {
  return state.buildings.find(
    (b): b is CapitalInstance => b.type === 'capital' && b.owner === seat,
  );
}

// ─────────────────────────── legalDeploySquares ──────────────────────

/**
 * All revealed squares where `seat` may deploy a unit: the capital
 * square itself plus any Chebyshev-adjacent square to an owned Barracks
 * whose cooldown marker (`damage`) is still below its ready threshold.
 */
export function legalDeploySquares(state: DeployStateLike, seat: Seat): readonly Coord[] {
  const player = state.players[seat];
  if (player === undefined) return [];

  const seen = new Set<string>();
  const out: Coord[] = [];

  const pushIfRevealed = (square: Coord): void => {
    const tileId = tileOfSquare(state, square);
    if (tileId === undefined) return;
    const tile = state.map.tiles.find((entry) => entry.id === tileId);
    if (tile === undefined || tile.faceDown) return;
    const key = coordKey(square);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x: square.x, y: square.y });
  };

  pushIfRevealed(player.capitalSquare);

  for (const building of state.buildings) {
    if (
      building.type !== 'barracks' ||
      building.owner !== seat ||
      building.damage >= BARRACKS_DEPLOY_HP
    ) {
      continue;
    }

    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        pushIfRevealed({
          x: building.square.x + dx,
          y: building.square.y + dy,
        });
      }
    }
  }

  return out;
}
