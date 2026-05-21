import { z } from 'zod';

export * from './ids.js';
export * from './resources.js';
export * from './civ.js';
export * from './cards.js';
export * from './state.js';
export * from './actions.js';

// ───────────────────────────── Identity ──────────────────────────────

export const GameId = z.string().min(4).max(16);
export type GameId = z.infer<typeof GameId>;

export const PlayerId = z.string().min(1);
export type PlayerId = z.infer<typeof PlayerId>;

/** Raw secret held by client in localStorage. Server stores only sha256 hash. */
export const PlayerToken = z.string().min(32);
export type PlayerToken = z.infer<typeof PlayerToken>;

export const Seat = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Seat = z.infer<typeof Seat>;

// ────────────────────────────── Map ──────────────────────────────────
//
// Map model (per `wedge-rulebook-synthesis.md`):
//   • Base game: 3×3 tile grid, each tile = 2×2 squares → 6×6 playable squares.
//   • `Coord` is a board-flat (x, y) in 0..5.
//   • `Tile.squares` holds the 4 squares belonging to the tile; their
//     `coord` values are board-flat positions, not tile-local.
//   • Tiles may be face-down (undiscovered) or face-up with an orientation
//     (rotation chosen on Scout reveal). Orientation only matters to the
//     renderer; the engine reads terrain per square.

/** Board-flat coordinate in the 6×6 base map. */
export const Coord = z.object({
  x: z.number().int().min(0).max(5),
  y: z.number().int().min(0).max(5),
});
export type Coord = z.infer<typeof Coord>;

/** Per-square terrain. Drives resource type for Camps and movement rules. */
export const TerrainType = z.enum([
  'plain',
  'mountain',
  'water',
  'river',
  'village',
  'farmland',
  'forest',
  'mine',
  'gold-double',
]);
export type TerrainType = z.infer<typeof TerrainType>;

/** A single square on the board. */
export const Square = z.object({
  coord: Coord,
  terrain: TerrainType,
});
export type Square = z.infer<typeof Square>;

/** Tile family. `starting` and `highland` come from the base game; */
/** `constantinople` is the named center tile from the expansion noted in the rulebook. */
export const TileKind = z.enum(['starting', 'highland', 'constantinople']);
export type TileKind = z.infer<typeof TileKind>;

/** Tile rotation in degrees, chosen on reveal. */
export const TileOrientation = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type TileOrientation = z.infer<typeof TileOrientation>;

/** A 2×2 tile. `squares` always holds exactly 4 entries (the tile's quadrants). */
export const Tile = z.object({
  id: z.string().min(1),
  kind: TileKind,
  orientation: TileOrientation,
  faceDown: z.boolean(),
  squares: z.array(Square).length(4),
});
export type Tile = z.infer<typeof Tile>;

// ───────────────────────────── Actions ───────────────────────────────
//
// The `Action` discriminated union is exported from `./actions.ts`
// (re-exported via `export *` above). Issue #5 replaced the original
// 3-action placeholder (PlayCard / EndTurn / Draw) with the full ~20
// action set covering Mobilization, Deployment, Opponent reactions,
// and Phase control.

// ────────────────────────────── Errors ───────────────────────────────

export const RuleError = z.object({
  code: z.string(),
  message: z.string(),
});
export type RuleError = z.infer<typeof RuleError>;
