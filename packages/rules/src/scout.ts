import type { Action, GameState, Seat, Tile } from '@eoe/schema';

import { err, ok, type Result } from './result.js';

// ─────────────────────────── scout (Issue #56) ──────────────────────
//
// MVP-3 / #56 — pure Scout handler: reveal a face-down tile.
//
// Phase + seat gating runs upstream in `applyAction` (Scout is only
// legal during `mobilization`, by the active seat). This handler only
// runs once those checks pass.
//
// Schema reminder: `ScoutAction = { type: 'Scout', unitId, target: Coord }`
// — Scout targets a **square coord**, not a tile id. We resolve the
// containing tile by walking `state.map.tiles[*].squares[*].coord`.
//
// Preconditions verified here:
//   1. A tile in `state.map.tiles` contains a square at `action.target`.
//   2. That tile's `faceDown` is `true`.
//
// MVP-3 simplifications (per the issue):
//   - No adjacency check (any face-down tile is scoutable, regardless
//     of the scouting unit's position or revealed-tile neighborhood).
//   - No card cost; no per-turn cap.
//   - No re-orientation step yet (rulebook lets the scouter pick a
//     rotation; #5x will lift that).
//   - `action.unitId` is NOT validated for existence/ownership/exhaust
//     for MVP-3 — flagged below as `@needs-confirmation`. Adjacency +
//     unit-validation lift in later MVPs.
//
// Determinism: no RNG, no clock, no I/O. Input `state` is not mutated;
// we splice a new `tiles` array with the target tile shallow-copied
// and `faceDown` flipped, leaving every other tile reference intact.
//
// Version: the rules engine NEVER bumps `state.version` — that lives
// in the Worker (matches `playCard.ts` and `deployUnit.ts` convention,
// per `wedge-multiplayer-architecture.md`). The issue prompt said
// "bump version" but the locked architecture is the source of truth.
// Pinned in the decision drop file.

type ScoutAction = Extract<Action, { type: 'Scout' }>;

export function scout(
  state: GameState,
  action: ScoutAction,
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

  // 1) Locate the tile containing the target square coord.
  //    Defensive: phase-gate tests stub Scout actions with only
  //    `{ type: 'Scout' }`, so `action.target` may be missing for
  //    inputs that haven't been Zod-parsed. Treat as tile_not_found
  //    rather than throwing.
  const target = action.target;
  if (target === undefined || typeof target.x !== 'number' || typeof target.y !== 'number') {
    return err(
      'tile_not_found',
      `Scout action is missing a valid target coord`,
    );
  }
  const targetIdx = state.map.tiles.findIndex((t) => tileContainsCoord(t, target));
  if (targetIdx < 0) {
    return err(
      'tile_not_found',
      `no tile contains square (${action.target.x},${action.target.y})`,
    );
  }

  // 2) Tile must currently be face-down.
  const tile = state.map.tiles[targetIdx];
  if (tile === undefined) {
    // Unreachable given the findIndex above, but the strict-mode
    // indexed-access type forces us to re-read.
    return err(
      'tile_not_found',
      `tile at index ${targetIdx} disappeared (defensive)`,
    );
  }
  if (tile.faceDown !== true) {
    return err(
      'tile_already_revealed',
      `tile ${tile.id} is already revealed`,
    );
  }

  // 3) Reveal — shallow-copy the target tile, splice a new tiles array.
  const revealed: Tile = { ...tile, faceDown: false };
  const newTiles = [
    ...state.map.tiles.slice(0, targetIdx),
    revealed,
    ...state.map.tiles.slice(targetIdx + 1),
  ];

  return ok({
    ...state,
    map: { ...state.map, tiles: newTiles },
  });
}

function tileContainsCoord(tile: Tile, c: { x: number; y: number }): boolean {
  for (const sq of tile.squares) {
    if (sq.coord.x === c.x && sq.coord.y === c.y) return true;
  }
  return false;
}
