import { z } from 'zod';

// ─────────────────────────── Branded IDs (leaf) ──────────────────────
//
// Leaf module — no internal imports. Holds the entity-instance IDs that
// `state.ts` and `actions.ts` BOTH need. Living here breaks the
// `state.ts` ↔ `actions.ts` cycle that would otherwise occur (state.ts
// owns `GameState`/`Player`/etc., actions.ts owns `Action`, but each
// references the other's types — actions need ids defined in state, and
// `ActionLogEntry` lives in state but uses `Action` from actions).
//
// Same pattern as `civ.ts` (extracted to break the index.ts ↔ cards.ts
// cycle in #3). Both `state.ts` and `actions.ts` import from this file;
// nothing here imports them.

/** Branded id for a deployed unit on the board. */
export const UnitInstanceId = z.string().min(1).brand<'UnitInstanceId'>();
export type UnitInstanceId = z.infer<typeof UnitInstanceId>;

/** Branded id for a building token on the board (Camp / Barracks / Capital). */
export const BuildingInstanceId = z.string().min(1).brand<'BuildingInstanceId'>();
export type BuildingInstanceId = z.infer<typeof BuildingInstanceId>;

/**
 * Branded id for a Tile on the board.
 *
 * MVP-6 S1 (issue #97): promoted from a free `z.string()` on `Tile.id`
 * so capital-tile membership (`CapitalInstance.tileId`) and helpers
 * (`tileOfSquare`, `unitsOnTile`) carry a typed link rather than a
 * coincidence of string equality. RFC: `wedge-capital-units-shape.md`.
 */
export const TileId = z.string().min(1).brand<'TileId'>();
export type TileId = z.infer<typeof TileId>;

/** Branded RNG seed. Engine takes deterministic seeds — no Math.random. */
export const Seed = z.string().min(1).brand<'Seed'>();
export type Seed = z.infer<typeof Seed>;
