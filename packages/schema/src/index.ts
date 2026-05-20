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
