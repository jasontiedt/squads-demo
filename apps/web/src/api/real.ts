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
    // Issue #38: create now returns redacted state with creator's hand
    // visible, so no follow-up GET is needed.
    const data = (await res.json()) as {
      gameCode: GameId;
      playerToken: PlayerToken;
      seat: Seat;
      state: PublicGameState;
      version: number;
    };
    return {
      gameCode: data.gameCode,
      seat: data.seat,
      playerToken: data.playerToken,
      state: data.state,
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
    // Issue #38: join now returns redacted state with joiner's hand
    // visible, so no follow-up GET is needed.
    const data = (await res.json()) as {
      gameCode: GameId;
      playerToken: PlayerToken;
      seat: Seat;
      state: PublicGameState;
      version: number;
    };
    return {
      gameCode: data.gameCode,
      seat: data.seat,
      playerToken: data.playerToken,
      state: data.state,
    };
  }

  async getGame(req: GetGameRequest): Promise<GetGameResponse> {
    const op = `GET /games/${req.gameCode}`;
    // Issue #38: send Authorization: Bearer <playerToken> so the
    // worker returns our own hand unredacted. Malformed/wrong tokens
    // silently fall back to public state (no 401), so the call never
    // fails on token issues — it just yields opaque hands.
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/games/${encodeURIComponent(req.gameCode)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${req.playerToken}` },
        },
      );
    } catch (err) {
      throw wrapNetworkError(err, op);
    }
    if (!res.ok) {
      await throwFromResponse(res, op);
    }
    const data = (await res.json()) as {
      state: PublicGameState;
      version: number;
      seat?: Seat;
    };
    // If the worker echoed back a seat, trust it. Otherwise fall back
    // to seat 1 (consumers like Lobby know their real seat from local
    // membership and don't read this field after rehydrate).
    const seat: Seat = data.seat ?? 1;
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
