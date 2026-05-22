// API client interface for the EOE web shell.
//
// Issue #15 wires the real Worker-backed implementation in
// `./real.ts`. The interface here is implementation-agnostic — both
// `MockGameApi` (dev/tests) and `RealGameApi` (live Worker) conform.
//
// State over the wire is *redacted*: each player's `hand` arrives as
// `{ count: number }`, never the actual card ids. We carry our own
// hand contents client-side from the original create/join/postAction
// responses; opponents' hands stay opaque.

import type {
  Action,
  Civ,
  GameId,
  GameState,
  Player,
  PlayerToken,
  Seat,
} from '@eoe/schema';
import { Seed } from '@eoe/schema';

// ─────────────────────────── Redacted state shape ────────────────────
//
// Mirror of the Worker's `redactStateForPublic` output. Kept web-local
// (no Zod parse needed — we trust our own Worker, and a malformed
// payload will surface as a runtime crash already caught by the API
// layer's try/catch). If we ever need to validate incoming state at
// the boundary, lift these into `@eoe/schema` as Zod schemas.

/**
 * Public view of a player — same as `Player` but `hand` is the size,
 * not the card ids.
 */
export interface RedactedPlayer extends Omit<Player, 'hand'> {
  readonly hand: { readonly count: number };
}

/** Public view of game state — every player's hand redacted. */
export interface PublicGameState extends Omit<GameState, 'players'> {
  readonly players: {
    readonly 1?: RedactedPlayer;
    readonly 2?: RedactedPlayer;
    readonly 3?: RedactedPlayer;
    readonly 4?: RedactedPlayer;
  };
}

// ─────────────────────────── Request / response shapes ──────────────

export interface CreateGameRequest {
  name: string;
  civ: Civ;
}

export interface CreateGameResponse {
  gameCode: GameId;
  seat: Seat;
  playerToken: PlayerToken;
  state: PublicGameState;
}

export interface JoinGameRequest {
  gameCode: GameId;
  name: string;
  civ: Civ;
}

export interface JoinGameResponse {
  gameCode: GameId;
  seat: Seat;
  playerToken: PlayerToken;
  state: PublicGameState;
}

export interface GetGameRequest {
  gameCode: GameId;
  playerToken: PlayerToken;
}

export interface GetGameResponse {
  state: PublicGameState;
  /** Seat the caller is sitting in. The live Worker GET is currently
   *  unauthenticated, so `RealGameApi` returns the caller's stored seat
   *  (passed in via membership). Mock derives it from the token. */
  seat: Seat;
}

export interface PostActionRequest {
  gameCode: GameId;
  seat: Seat;
  token: PlayerToken;
  expectedVersion: number;
  action: Action;
}

export interface PostActionResponse {
  state: PublicGameState;
  version: number;
}

// ─────────────────────────── Error types ────────────────────────────

export class ApiError extends Error {
  public readonly code: string;
  public readonly status: number | undefined;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** 409 — caller's `expectedVersion` is stale. Caller may refetch + retry. */
export class VersionMismatchError extends ApiError {
  public readonly current: number;
  public readonly expected: number;
  constructor(current: number, expected: number, message?: string) {
    super(
      'version_mismatch',
      message ?? `State moved on (current=${current}, expected=${expected}).`,
      409,
    );
    this.name = 'VersionMismatchError';
    this.current = current;
    this.expected = expected;
  }
}

/** 401 — token rejected for seat. Caller should drop membership and bounce home. */
export class AuthError extends ApiError {
  constructor(message?: string) {
    super('unauthorized', message ?? 'Invalid token for seat.', 401);
    this.name = 'AuthError';
  }
}

/** 400 — rules engine rejected the action. `code` is the engine's code. */
export class InvalidActionError extends ApiError {
  constructor(code: string, message?: string) {
    super(code, message ?? `Action rejected: ${code}`, 400);
    this.name = 'InvalidActionError';
  }
}

/** 404 — no such game. Caller should bounce home with a friendly message. */
export class NotFoundError extends ApiError {
  constructor(message?: string) {
    super('not_found', message ?? 'Game not found.', 404);
    this.name = 'NotFoundError';
  }
}

// ─────────────────────────── Interface ──────────────────────────────

/**
 * Game API contract. Both `MockGameApi` and `RealGameApi` implement it.
 * Live wire format documented per-method.
 */
export interface GameApi {
  createGame(req: CreateGameRequest): Promise<CreateGameResponse>;
  joinGame(req: JoinGameRequest): Promise<JoinGameResponse>;
  getGame(req: GetGameRequest): Promise<GetGameResponse>;
  postAction(req: PostActionRequest): Promise<PostActionResponse>;
}

// ─────────────────────────── Helpers ────────────────────────────────

/** Build a minimal-but-valid placeholder PublicGameState for the lobby shell. */
export const placeholderState = (gameId: string): PublicGameState => ({
  version: 0,
  gameId,
  seed: Seed.parse(`stub-seed-${gameId}`),
  phase: 'mobilization',
  activePlayer: 1,
  turn: 1,
  players: {},
  units: [],
  buildings: [],
  map: { tiles: [] },
  moveLog: [],
});
