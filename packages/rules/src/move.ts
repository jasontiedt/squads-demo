import { loadCivMeta } from '@eoe/assets-meta';
import type {
  Action,
  Coord,
  GameState,
  Seat,
  UnitInstance,
} from '@eoe/schema';

import { err, ok, type Result } from './result.js';

// ─────────────────────────── move (Issue #67) ────────────────────────
//
// MVP-4 #1 — pure Move handler: a unit walks across the 6×6 board
// within its `movement.points`, blocked by impassable terrain, occupied
// squares, and face-down tiles.
//
// Phase + seat gating runs upstream in `applyAction` (Move is only legal
// during `mobilization`, by the active seat — see `phases.ts`. Note the
// issue body says "deployment" but the canonical phase table puts Move
// alongside Attack in `mobilization`; the table is the source of truth.)
// This handler only runs once those checks pass.
//
// Schema reminder: `MoveUnitAction = { type: 'MoveUnit', unitId, from,
// to }`. `from` is included for client/server consistency; we verify it
// matches the unit's actual square and reject otherwise (stale UI guard).
//
// Preconditions verified here:
//   1. Unit exists in `state.units[]` and is owned by `actorId`.
//   2. Unit is NOT exhausted (one action per unit per turn — matches
//      Attack's pattern; see `artoo-attack-acted-tracking.md`).
//   3. `action.from` matches the unit's current `square`.
//   4. `action.to` is NOT the same as `action.from` (no zero-distance
//      move — UI should send EndPhase if the player wants to skip).
//   5. Distance (Chebyshev — see helper) does not exceed the unit
//      card's `movement.points`.
//   6. Destination square sits on a face-up tile in `state.map.tiles`.
//      A face-down tile, or a coord with no tile at all, is blocked.
//   7. Destination terrain is not `water` or `mountain`.
//   8. Destination square is not occupied by ANY unit (friend or enemy).
//
// Effects (on success):
//   • Unit's `square` updates to `action.to`.
//   • Unit's `exhausted` flag flips to `true`.
//
// Determinism: no RNG, no clock, no I/O. Input `state` is not mutated;
// we splice a new `units` array.
//
// Version: the rules engine NEVER bumps `state.version` — that lives
// in the Worker (matches `attack.ts`, `playCard.ts`, `scout.ts`,
// `deployUnit.ts` — wedge-multiplayer-architecture.md is the source of
// truth).
//
// MVP-4 simplifications (out of scope per issue spec):
//   - `movement.pattern: 'short' | 'long'` distinction deferred to
//     MVP-5 with naval units. For MVP-4 every unit uses Chebyshev
//     points regardless of pattern.
//   - No path-tracing through intermediate squares (only origin and
//     destination are checked). Unblocked diagonal jumps over impassable
//     terrain are legal under this MVP — pinned in the test suite as
//     `@needs-confirmation`.
//   - No "zone of control" or opponent-adjacency penalties.

type MoveAction = Extract<Action, { type: 'MoveUnit' }>;

/**
 * Chebyshev distance between two coords: `max(|Δx|, |Δy|)`. Treats
 * orthogonal and diagonal steps as equal length (chess-king metric).
 * Exported for tests; matches the inline calc in `attack.ts`.
 */
export function chebyshev(a: Coord, b: Coord): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx > dy ? dx : dy;
}

export function move(
  state: GameState,
  action: MoveAction,
  actorId: Seat,
): Result<GameState> {
  // Defensive — upstream gate should always catch this, but
  // `state.players[seat]` is `Player | undefined` under
  // `noUncheckedIndexedAccess`.
  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  // 1) Locate the unit.
  const unitIdx = state.units.findIndex((u) => u.id === action.unitId);
  if (unitIdx < 0) {
    return err(
      'unit_not_found',
      `unit ${action.unitId} is not on the board`,
    );
  }
  const unit = state.units[unitIdx];
  if (unit === undefined) {
    // Unreachable given findIndex, but strict-mode indexed-access
    // forces us to re-read.
    return err(
      'unit_not_found',
      `unit at index ${unitIdx} disappeared (defensive)`,
    );
  }

  // 2) Ownership.
  if (unit.owner !== actorId) {
    return err(
      'unit_not_yours',
      `unit ${action.unitId} is owned by seat ${unit.owner}, not actor seat ${actorId}`,
    );
  }

  // 3) Exhaustion (one action per unit per turn).
  if (unit.exhausted) {
    return err(
      'unit_exhausted',
      `unit ${action.unitId} has already acted this turn`,
    );
  }

  // 4) `action.from` must match the unit's current square. Catches
  //    stale UI sending a move from where the unit used to be.
  if (action.from.x !== unit.square.x || action.from.y !== unit.square.y) {
    return err(
      'illegal_move',
      `action.from (${action.from.x},${action.from.y}) does not match unit's current square (${unit.square.x},${unit.square.y})`,
    );
  }

  // 5) Reject zero-distance moves. Cheap guard; surfaces caller bugs
  //    before the range / terrain checks (which would also reject, but
  //    less informatively).
  if (action.to.x === action.from.x && action.to.y === action.from.y) {
    return err(
      'illegal_move',
      `destination (${action.to.x},${action.to.y}) is the same as origin; a Move must change the unit's square`,
    );
  }

  // 6) Range check. Chebyshev distance: max(|Δx|, |Δy|).
  const distance = chebyshev(action.from, action.to);

  // 7) Look up the unit's card for `movement.points`.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === unit.cardId);
  if (card === undefined || card.kind !== 'unit') {
    return err(
      'card_not_in_catalog',
      `unit's card ${unit.cardId} not found in catalog for civ ${player.civ}, or is not a unit card`,
    );
  }
  if (distance > card.movement.points) {
    return err(
      'out_of_range',
      `move distance ${distance} exceeds unit ${action.unitId}'s movement.points (${card.movement.points})`,
    );
  }

  // 8) Destination tile / square lookup. A square is on the board iff
  //    some tile in `state.map.tiles` has a Square entry at that coord.
  //    A face-down tile blocks movement onto any of its squares.
  let destSquare: { terrain: string } | undefined;
  let destTileFaceDown = false;
  for (const tile of state.map.tiles) {
    const sq = tile.squares.find(
      (s) => s.coord.x === action.to.x && s.coord.y === action.to.y,
    );
    if (sq !== undefined) {
      destSquare = sq;
      destTileFaceDown = tile.faceDown;
      break;
    }
  }
  if (destSquare === undefined) {
    return err(
      'illegal_move',
      `destination (${action.to.x},${action.to.y}) is not on any explored tile (face-down or off-board)`,
    );
  }
  if (destTileFaceDown) {
    return err(
      'illegal_move',
      `destination (${action.to.x},${action.to.y}) sits on a face-down tile; reveal it via Scout first`,
    );
  }

  // 9) Impassable terrain.
  if (destSquare.terrain === 'water' || destSquare.terrain === 'mountain') {
    return err(
      'illegal_move',
      `destination (${action.to.x},${action.to.y}) terrain '${destSquare.terrain}' is impassable`,
    );
  }

  // 10) Occupied-square check (friend OR enemy — stacking is not
  //     allowed for MVP-4).
  const blocker = state.units.find(
    (u) => u.square.x === action.to.x && u.square.y === action.to.y,
  );
  if (blocker !== undefined) {
    return err(
      'illegal_move',
      `destination (${action.to.x},${action.to.y}) is occupied by unit ${blocker.id} (owner seat ${blocker.owner})`,
    );
  }

  // 11) Apply the move. New unit slice with updated square + exhausted
  //     flag; rest of state.units untouched (same reference order).
  const movedUnit: UnitInstance = {
    ...unit,
    square: { x: action.to.x, y: action.to.y },
    exhausted: true,
  };
  const newUnits = state.units.map((u, i) => (i === unitIdx ? movedUnit : u));

  return ok({
    ...state,
    units: newUnits,
  });
}
