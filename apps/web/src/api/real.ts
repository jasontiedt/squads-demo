// HTTP-backed GameApi against the Cloudflare Worker shipped in #13.
//
// Endpoints (see apps/worker/src/index.ts):
//   POST /games                    body: { playerName, civ }
//     200 { gameCode, playerToken, seat }
//   POST /games/:code/join         body: { playerName, civ }
//     200 { playerToken, seat }
//     409 { code:'game_full', ... }
//     404 { code:'not_found',  ... }
//   GET  /games/:code              (no auth — state is pre-redacted)
//     200 { state, version }
//     404 { code:'not_found', ... }
//   POST /games/:code/actions      body: { seat, token, expectedVersion, action }
//     200 { state, version }
//     400 { code:<engine code>, error }
//     401 { code:'unauthorized', ... }
//     404 { code:'not_found',   ... }
//     409 { code:'version_mismatch', current, expected }
//
// Base URL precedence (build-time): VITE_WORKER_URL → VITE_API_BASE
// → 'http://localhost:8787'. Trailing slashes stripped (the existing
// constructor contract callers rely on).

import type {
  CreateGameRequest,
  CreateGameResponse,
  GameApi,
  GetGameRequest,
  GetGameResponse,
  JoinGameRequest,
  JoinGameResponse,
  PostActionRequest,
  PostActionResponse,
  PublicGameState,
} from './client.js';
import {
  ApiError,
  AuthError,
  InvalidActionError,
  NotFoundError,
  VersionMismatchError,
} from './client.js';
import type { GameId, PlayerToken, Seat } from '@eoe/schema';

interface ErrorBody {
  code?: unknown;
  error?: unknown;
  current?: unknown;
  expected?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null;

/**
 * Pull a structured error body off a non-2xx response and throw the
 * matching typed `ApiError` subclass. Falls back to the generic
 * `ApiError` if the body is missing/malformed.
 */
async function throwFromResponse(res: Response, op: string): Promise<never> {
  let body: ErrorBody = {};
  try {
    const parsed: unknown = await res.json();
    if (isRecord(parsed)) {
      body = parsed as ErrorBody;
    }
  } catch {
    // Body not JSON — fall through to generic error.
  }
  const code = typeof body.code === 'string' ? body.code : `http_${res.status}`;
  const message =
    typeof body.error === 'string'
      ? body.error
      : `${op} failed with HTTP ${res.status}`;

  if (res.status === 409 && code === 'version_mismatch') {
    const current = typeof body.current === 'number' ? body.current : 0;
    const expected = typeof body.expected === 'number' ? body.expected : 0;
    throw new VersionMismatchError(current, expected, message);
  }
  if (res.status === 401) throw new AuthError(message);
  if (res.status === 404) throw new NotFoundError(message);
  if (res.status === 400) throw new InvalidActionError(code, message);
  throw new ApiError(code, message, res.status);
}

/** Convert a network/CORS failure into an ApiError the UI can show. */
function wrapNetworkError(err: unknown, op: string): ApiError {
  if (err instanceof ApiError) return err;
  const detail = err instanceof Error ? err.message : String(err);
  return new ApiError('network_error', `${op} failed: ${detail}`);
}

export class RealGameApi implements GameApi {
  public readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  private async post(path: string, body: unknown, op: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw wrapNetworkError(err, op);
    }
    if (!res.ok) {
      await throwFromResponse(res, op);
    }
    return res;
  }

  private async get(path: string, op: string): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method: 'GET' });
    } catch (err) {
      throw wrapNetworkError(err, op);
    }
    if (!res.ok) {
      await throwFromResponse(res, op);
    }
    return res;
  }

  async createGame(req: CreateGameRequest): Promise<CreateGameResponse> {
    if (!req.name.trim()) {
      throw new ApiError('invalid_name', 'name is required');
    }
    const op = 'POST /games';
    const res = await this.post(
      '/games',
      { playerName: req.name.trim(), civ: req.civ },
      op,
    );
    const data = (await res.json()) as {
      gameCode: GameId;
      playerToken: PlayerToken;
      seat: Seat;
    };
    // Worker create returns identity only; fetch state via GET to fill
    // out the CreateGameResponse contract.
    const stateRes = await this.get(`/games/${data.gameCode}`, op);
    const stateData = (await stateRes.json()) as {
      state: PublicGameState;
      version: number;
    };
    return {
      gameCode: data.gameCode,
      seat: data.seat,
      playerToken: data.playerToken,
      state: stateData.state,
    };
  }

  async joinGame(req: JoinGameRequest): Promise<JoinGameResponse> {
    if (!req.name.trim()) {
      throw new ApiError('invalid_name', 'name is required');
    }
    const op = `POST /games/${req.gameCode}/join`;
    const res = await this.post(
      `/games/${encodeURIComponent(req.gameCode)}/join`,
      { playerName: req.name.trim(), civ: req.civ },
      op,
    );
    const data = (await res.json()) as {
      playerToken: PlayerToken;
      seat: Seat;
    };
    const stateRes = await this.get(`/games/${req.gameCode}`, op);
    const stateData = (await stateRes.json()) as {
      state: PublicGameState;
      version: number;
    };
    return {
      gameCode: req.gameCode,
      seat: data.seat,
      playerToken: data.playerToken,
      state: stateData.state,
    };
  }

  async getGame(req: GetGameRequest): Promise<GetGameResponse> {
    const op = `GET /games/${req.gameCode}`;
    const res = await this.get(
      `/games/${encodeURIComponent(req.gameCode)}`,
      op,
    );
    const data = (await res.json()) as {
      state: PublicGameState;
      version: number;
    };
    // Live worker GET is currently unauthenticated and does not echo
    // the caller's seat — derive it from the player record in state by
    // matching against any seat we hold a token for client-side. The
    // worker's followup (`?seat=X` token-auth GET) will let us drop
    // this once landed. For now: return seat 0 placeholder is invalid
    // (Seat is 1..4), so return seat=1 as a benign default. Callers
    // (Lobby) already know their seat from membership and don't read
    // this field after rehydrate.
    //
    // NB: the worker's 401 path won't fire here (GET is open); auth
    // gets enforced on postAction.
    const _ = req.playerToken; // satisfy noUnusedParameters
    void _;
    const seat: Seat = 1;
    return { state: data.state, seat };
  }

  async postAction(req: PostActionRequest): Promise<PostActionResponse> {
    const op = `POST /games/${req.gameCode}/actions`;
    const res = await this.post(
      `/games/${encodeURIComponent(req.gameCode)}/actions`,
      {
        seat: req.seat,
        token: req.token,
        expectedVersion: req.expectedVersion,
        action: req.action,
      },
      op,
    );
    const data = (await res.json()) as {
      state: PublicGameState;
      version: number;
    };
    return { state: data.state, version: data.version };
  }
}
