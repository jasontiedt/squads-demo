import { z } from 'zod';

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

export const Civ = z.enum([
  'byzantines',
  'hre',
  'mongols',
  'norsemen',
  'ottomans',
  'scots',
  'english',
]);
export type Civ = z.infer<typeof Civ>;

// ───────────────────────────── Phases ────────────────────────────────

export const GamePhase = z.enum(['lobby', 'setup', 'playing', 'ended']);
export type GamePhase = z.infer<typeof GamePhase>;

export const TurnPhase = z.enum(['draw', 'main', 'combat', 'end']);
export type TurnPhase = z.infer<typeof TurnPhase>;

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
//
// `kind` enumerates the tile families present in the base game + Constantinople
// expansion referenced by the rulebook. Card data and richer tile content are
// out of scope for this issue (#1) — populated later from PDF OCR.

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

// ───────────────────────────── Players ───────────────────────────────

export const Player = z.object({
  id: PlayerId,
  seat: Seat,
  name: z.string().min(1).max(40),
  civ: Civ,
  tokenHash: z.string(),
  connected: z.boolean(),
});
export type Player = z.infer<typeof Player>;

// ─────────────────────────── Game state ──────────────────────────────

/** Card payload kept loose for MVP — real card metadata lives in @eoe/assets-meta. */
export const CardId = z.string();
export type CardId = z.infer<typeof CardId>;

export const Deck = z.array(CardId);
export type Deck = z.infer<typeof Deck>;

export const GameState = z.object({
  gameId: GameId,
  version: z.number().int().nonnegative(),
  phase: GamePhase,
  turnPhase: TurnPhase,
  players: z.array(Player).min(1).max(4),
  turnIndex: z.number().int().nonnegative(),
  /** Civ-agnostic board state. Shape TBD by Artoo — kept loose for MVP. */
  board: z.unknown(),
  decksByPlayer: z.record(PlayerId, Deck),
  handsByPlayer: z.record(PlayerId, z.array(CardId)),
  moveLog: z.array(z.unknown()),
  winner: PlayerId.optional(),
});
export type GameState = z.infer<typeof GameState>;

// ───────────────────────────── Actions ───────────────────────────────

export const PlayCardAction = z.object({
  type: z.literal('play_card'),
  cardId: CardId,
});

export const EndTurnAction = z.object({
  type: z.literal('end_turn'),
});

export const DrawAction = z.object({
  type: z.literal('draw'),
  count: z.number().int().positive(),
});

export const Action = z.discriminatedUnion('type', [PlayCardAction, EndTurnAction, DrawAction]);
export type Action = z.infer<typeof Action>;

// ────────────────────────────── Errors ───────────────────────────────

export const RuleError = z.object({
  code: z.string(),
  message: z.string(),
});
export type RuleError = z.infer<typeof RuleError>;
