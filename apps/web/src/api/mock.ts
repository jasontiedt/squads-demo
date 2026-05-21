// In-memory mock implementation of GameApi. Used in dev, tests, and as the
// default until issue #13 wires the real Worker calls.

import type {
  CreateGameRequest,
  CreateGameResponse,
  GameApi,
  GetGameRequest,
  GetGameResponse,
  JoinGameRequest,
  JoinGameResponse,
} from './client.js';
import { ApiError, placeholderState } from './client.js';
import type { GameId, GameState, PlayerToken, Seat } from '@eoe/schema';

// Tokens must be ≥32 chars per @eoe/schema PlayerToken. Pad deterministically.
const pad = (s: string): string => (s + '-'.repeat(40)).slice(0, 40);

interface MockGameRecord {
  code: GameId;
  state: GameState;
  /** seat → playerToken assigned at join/create time. */
  tokensBySeat: Map<Seat, PlayerToken>;
}

export interface MockGameApiOptions {
  /** Override the next-issued gameCode (useful for tests). */
  nextGameCode?: GameId | undefined;
}

export class MockGameApi implements GameApi {
  private readonly games = new Map<string, MockGameRecord>();
  private overrideNextCode: GameId | undefined;
  private counter = 0;

  constructor(opts: MockGameApiOptions = {}) {
    this.overrideNextCode = opts.nextGameCode;
  }

  private nextCode(): GameId {
    if (this.overrideNextCode !== undefined) {
      const c = this.overrideNextCode;
      this.overrideNextCode = undefined;
      return c;
    }
    this.counter += 1;
    // 6-char uppercase code, e.g. STUB01
    const n = String(this.counter).padStart(2, '0');
    return `STUB${n}`;
  }

  async createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
    if (!req.name.trim()) {
      throw new ApiError('invalid_name', 'name is required');
    }
    const code = this.nextCode();
    const seat: Seat = 1;
    const token = pad(`token-host-${code}`) as PlayerToken;
    const state = placeholderState(code);
    const record: MockGameRecord = {
      code,
      state,
      tokensBySeat: new Map([[seat, token]]),
    };
    this.games.set(code, record);
    return { gameCode: code, seat, playerToken: token, state };
  }

  async joinGame(req: JoinGameRequest): Promise<JoinGameResponse> {
    if (!req.name.trim()) {
      throw new ApiError('invalid_name', 'name is required');
    }
    // For the shell mock, accept any well-formed code: if we haven't seen it
    // we lazily create a host slot so the join flow works in isolation.
    let record = this.games.get(req.gameCode);
    if (!record) {
      record = {
        code: req.gameCode,
        state: placeholderState(req.gameCode),
        tokensBySeat: new Map(),
      };
      this.games.set(req.gameCode, record);
    }
    const seat = nextOpenSeat(record);
    if (seat === null) {
      throw new ApiError('game_full', 'no open seats');
    }
    const token = pad(`token-seat${seat}-${req.gameCode}`) as PlayerToken;
    record.tokensBySeat.set(seat, token);
    return {
      gameCode: req.gameCode,
      seat,
      playerToken: token,
      state: record.state,
    };
  }

  async getGame(req: GetGameRequest): Promise<GetGameResponse> {
    const record = this.games.get(req.gameCode);
    if (!record) {
      throw new ApiError('not_found', `unknown game ${req.gameCode}`, 404);
    }
    let foundSeat: Seat | undefined;
    for (const [seat, tk] of record.tokensBySeat) {
      if (tk === req.playerToken) {
        foundSeat = seat;
        break;
      }
    }
    if (foundSeat === undefined) {
      throw new ApiError('unauthorized', 'invalid playerToken for game', 401);
    }
    return { state: record.state, seat: foundSeat };
  }
}

const nextOpenSeat = (record: MockGameRecord): Seat | null => {
  const seats: Seat[] = [1, 2, 3, 4];
  for (const s of seats) {
    if (!record.tokensBySeat.has(s)) return s;
  }
  return null;
};
