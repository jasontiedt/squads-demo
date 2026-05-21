// API client interface for the EOE web shell.
//
// Issue #14 ships the shell only — the real fetch implementation lands in
// #13 once the Worker endpoints exist. Everything here is the type contract
// + a Mock implementation for development and tests + a Real stub that
// throws so any accidental wiring is loud rather than silent.

import type {
  Civ,
  GameId,
  GameState,
  PlayerToken,
  Seat,
} from '@eoe/schema';
import { Seed } from '@eoe/schema';

// ─────────────────────────── Request / response shapes ──────────────

export interface CreateGameRequest {
  name: string;
  civ: Civ;
}

export interface CreateGameResponse {
  gameCode: GameId;
  seat: Seat;
  playerToken: PlayerToken;
  state: GameState;
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
  state: GameState;
}

export interface GetGameRequest {
  gameCode: GameId;
  playerToken: PlayerToken;
}

export interface GetGameResponse {
  state: GameState;
  seat: Seat;
}

// ─────────────────────────── Error type ─────────────────────────────

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

// ─────────────────────────── Interface ──────────────────────────────

/**
 * Game API contract. `MockGameApi` ships for #14; `RealGameApi` (HTTP-backed)
 * lands in #13 once the Worker endpoints exist.
 */
export interface GameApi {
  createGame(req: CreateGameRequest): Promise<CreateGameResponse>;
  joinGame(req: JoinGameRequest): Promise<JoinGameResponse>;
  getGame(req: GetGameRequest): Promise<GetGameResponse>;
}

// ─────────────────────────── Helpers ────────────────────────────────

/** Build a minimal-but-valid placeholder GameState for the lobby shell. */
export const placeholderState = (gameId: string): GameState => ({
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
