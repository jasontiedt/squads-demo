import { z } from 'zod';
import { CardId } from './cards.js';
import { Civ } from './civ.js';
import { ResourceToken, TemporaryResource } from './resources.js';

// ─────────────────────────── Game state ──────────────────────────────
//
// Issue #4: GameState, Player, UnitInstance, BuildingInstance.
//
// Per `wedge-rulebook-synthesis.md`:
//   • Turn phases: Start → Mobilization → Deployment → End. Skipped on
//     turn 1 is a rules-engine concern, not a schema concern.
//   • Seats are 1..4. Two-player MVP-1 uses seats 1 and 2 only.
//   • Per-player Capital is a building with HP — modeled here on Player
//     (capitalHp + capitalSquare) so Player parsing alone gates HP, and
//     a matching `BuildingInstance(type:'capital')` lives in
//     `GameState.buildings` for board/damage operations.
//   • `Action` discriminated union is OUT OF SCOPE for #4 — lands in #5.
//     `ActionLogEntry` is intentionally minimal here so `moveLog` and
//     `pendingReactionWindow` can be typed today and tightened in #5.
//
// `Seat` lives in `./index.ts` (already exported there). Importing it
// here would create an `index.ts` ↔ `state.ts` cycle, so the literal
// is redeclared and aliased. Both definitions infer to the same
// `1 | 2 | 3 | 4` literal union, so consumers see one type.

// ─────────────────────────── Identity (branded) ──────────────────────

/** Branded id for a deployed unit on the board. */
export const UnitInstanceId = z.string().min(1).brand<'UnitInstanceId'>();
export type UnitInstanceId = z.infer<typeof UnitInstanceId>;

/** Branded id for a building token on the board (Camp / Barracks / Capital). */
export const BuildingInstanceId = z.string().min(1).brand<'BuildingInstanceId'>();
export type BuildingInstanceId = z.infer<typeof BuildingInstanceId>;

/** Branded RNG seed. Engine takes deterministic seeds — no Math.random. */
export const Seed = z.string().min(1).brand<'Seed'>();
export type Seed = z.infer<typeof Seed>;

// ─────────────────────────── Local re-declarations ───────────────────

/**
 * Re-declared here to break the `state.ts` ↔ `index.ts` import cycle
 * that would otherwise occur (index.ts re-exports state.ts; state.ts
 * needs `Seat`, `Coord`, `TerrainType`, `Tile`). Schemas are structurally
 * identical to those in `./index.ts` and produce the same TS types.
 */
const Seat = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
type Seat = z.infer<typeof Seat>;

const Coord = z.object({
  x: z.number().int().min(0).max(5),
  y: z.number().int().min(0).max(5),
});
type Coord = z.infer<typeof Coord>;

const TerrainType = z.enum([
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
type TerrainType = z.infer<typeof TerrainType>;

const Square = z.object({
  coord: Coord,
  terrain: TerrainType,
});

const TileKind = z.enum(['starting', 'highland', 'constantinople']);

const TileOrientation = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

const Tile = z.object({
  id: z.string().min(1),
  kind: TileKind,
  orientation: TileOrientation,
  faceDown: z.boolean(),
  squares: z.array(Square).length(4),
});

// ─────────────────────────── Phase ──────────────────────────────────

/**
 * Turn phase machine — rulebook §"Turn Structure".
 *
 * - `start`: unexhaust Main resources & units. Skipped on turn 1.
 * - `mobilization`: board phase (move/build/attack/ability/Tactic).
 * - `deployment`: card phase (deploy units, play Technology/Tactic).
 * - `end`: draw to 5 (or +1 if ≥5), discard down to 7. No reshuffle.
 */
export const TurnPhase = z.enum(['start', 'mobilization', 'deployment', 'end']);
export type TurnPhase = z.infer<typeof TurnPhase>;

// ─────────────────────────── Player ─────────────────────────────────

/**
 * Per-player Unit Field tracking. Issue #4 scope is just the
 * king/queen-used booleans. Pawn-slot occupancy lands when the
 * Deploy action is implemented (#5).
 */
export const UnitField = z.object({
  kingPawnUsed: z.boolean(),
  queenPawnUsed: z.boolean(),
});
export type UnitField = z.infer<typeof UnitField>;

/**
 * Player state.
 *
 * - `capitalHp` — base game starts at 10, long game at 20 (rulebook
 *   §"Setup" line 77 and §"Long Game" line 324). Schema accepts any
 *   non-negative integer; the rules engine seeds the starting value.
 * - `hand` capped at 7 (rulebook §"End of Turn"). Hard cap.
 * - `activeEvents` capped at 3 (rulebook §"Events").
 * - `firstPlayerSecondPlayerWild` — turn-1 freebie for seat 2 per
 *   rulebook. Optional: omitted ≡ false. With `exactOptionalPropertyTypes`
 *   that means `{...}` and `{..., firstPlayerSecondPlayerWild: false}`
 *   are both valid.
 */
export const Player = z.object({
  seat: Seat,
  civ: Civ,
  capitalHp: z.number().int().min(0),
  capitalSquare: Coord,
  hand: z.array(CardId).max(7),
  deck: z.array(CardId),
  discard: z.array(CardId),
  resources: z.array(ResourceToken),
  temporaryResources: z.array(TemporaryResource),
  activeEvents: z.array(CardId).max(3),
  unitField: UnitField,
  civCardId: CardId,
  firstPlayerSecondPlayerWild: z.boolean().optional(),
});
export type Player = z.infer<typeof Player>;

// ─────────────────────────── Unit instance ──────────────────────────

/** Combat mode toggle (rulebook §"Switch Attack Mode"). */
export const AttackMode = z.enum(['melee', 'ranged']);
export type AttackMode = z.infer<typeof AttackMode>;

/** King/Queen pawn attachment, +1/+2 to a unit. Optional. */
export const PawnBonus = z.enum(['king', 'queen']);
export type PawnBonus = z.infer<typeof PawnBonus>;

/**
 * A deployed unit on the board. `cardId` references the catalog card;
 * `id` is this specific instance (so two copies of the same unit have
 * distinct ids and independent damage / upgrades / pawn bonus).
 */
export const UnitInstance = z.object({
  id: UnitInstanceId,
  cardId: CardId,
  owner: Seat,
  square: Coord,
  exhausted: z.boolean(),
  damage: z.number().int().min(0),
  attackMode: AttackMode,
  upgrades: z.array(CardId),
  pawnBonus: PawnBonus.optional(),
});
export type UnitInstance = z.infer<typeof UnitInstance>;

// ─────────────────────────── Building instance ──────────────────────
//
// DESIGN: discriminated union by `type`. Issue #4 specifies that
// `terrain` is present only on Camp. A discriminated union enforces
// this statically (a `barracks` shape with `terrain` parses-rejects)
// and gives consumers free type-narrowing at use sites:
//
//   if (b.type === 'camp') b.terrain // → TerrainType, no `?`
//
// The alternative — a single optional-`terrain` shape with `.refine()`
// to reject Barracks/Capital + terrain — works but requires every
// consumer to repeat the narrowing manually and leaks an "always
// optional" type to the engine.

// Variants use `.strict()` so a `terrain` key on Barracks or Capital is
// REJECTED at parse time rather than silently stripped — the whole point
// of the discriminated union is structural enforcement of
// "terrain only on Camp".

/** Camp: built on a square; terrain drives the resource kind it produces. */
export const CampInstance = z
  .object({
    id: BuildingInstanceId,
    type: z.literal('camp'),
    owner: Seat,
    square: Coord,
    damage: z.number().int().min(0),
    terrain: TerrainType,
  })
  .strict();

/** Barracks: deploys units adjacent to itself. No terrain attribute. */
export const BarracksInstance = z
  .object({
    id: BuildingInstanceId,
    type: z.literal('barracks'),
    owner: Seat,
    square: Coord,
    damage: z.number().int().min(0),
  })
  .strict();

/** Capital: starting building; HP tracked on the matching `Player`. */
export const CapitalInstance = z
  .object({
    id: BuildingInstanceId,
    type: z.literal('capital'),
    owner: Seat,
    square: Coord,
    damage: z.number().int().min(0),
  })
  .strict();

export const BuildingInstance = z.discriminatedUnion('type', [
  CampInstance,
  BarracksInstance,
  CapitalInstance,
]);
export type BuildingInstance = z.infer<typeof BuildingInstance>;

// ─────────────────────────── Action log ─────────────────────────────

/**
 * Minimal log entry for `GameState.moveLog` and the `pendingReactionWindow`
 * trigger. Tightened to the full `Action` discriminated union in #5.
 *
 * @needs-confirmation: Replace `kind: string` and `payload: unknown` with
 *   the discriminated `Action` union once #5 lands. Migration: every
 *   ActionLogEntry's `kind` becomes the Action's `type` literal; `payload`
 *   becomes the rest of the Action members.
 */
export const ActionLogEntry = z.object({
  at: z.string().datetime(),
  seat: Seat,
  kind: z.string().min(1),
  payload: z.unknown(),
});
export type ActionLogEntry = z.infer<typeof ActionLogEntry>;

// ─────────────────────────── Game state ─────────────────────────────

/**
 * Players keyed by seat (1..4). Modeled as an explicit `z.object` rather
 * than `z.record(Seat, Player)` because Zod's record keys are always
 * strings at the JSON level — a `Seat` literal-number schema would
 * reject every key. `z.object` with numeric properties preserves the
 * seat-number key semantics and matches `Record<Seat, Player>` shape.
 *
 * 2- and 3-player games leave the unused seats undefined.
 */
const PlayersBySeat = z.object({
  1: Player.optional(),
  2: Player.optional(),
  3: Player.optional(),
  4: Player.optional(),
});

/** Map metadata for the engine. Tile catalog + per-square terrain live in `Tile.squares`. */
const GameMap = z.object({
  tiles: z.array(Tile),
});

/**
 * Reaction-window slot. Empty for MVP-1 — schema-shaped so #5's Action
 * union and the rules engine can populate it without a schema change.
 */
const PendingReactionWindow = z.object({
  triggeredBy: ActionLogEntry,
});

/**
 * Canonical persistence shape. The Worker writes one of these per gameId
 * to KV; the rules engine takes one in and returns one out.
 *
 * `version` is bumped on every successful action — drives optimistic
 * concurrency in the Worker.
 */
export const GameState = z.object({
  version: z.number().int().nonnegative(),
  gameId: z.string().min(1),
  seed: Seed,
  phase: TurnPhase,
  activePlayer: Seat,
  turn: z.number().int().positive(),
  players: PlayersBySeat,
  units: z.array(UnitInstance),
  buildings: z.array(BuildingInstance),
  map: GameMap,
  moveLog: z.array(ActionLogEntry),
  pendingReactionWindow: PendingReactionWindow.optional(),
});
export type GameState = z.infer<typeof GameState>;
