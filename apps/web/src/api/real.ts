// HTTP-backed GameApi against the Cloudflare Worker.
//
// Stub for #14 — every method throws "not yet wired — issue #13".
// Issue #13 will replace the throws with real `fetch` calls hitting
// VITE_API_BASE. Keep the constructor signature (baseUrl) so callers
// already wire it correctly and only the method bodies need to change.

import type {
  CreateGameRequest,
  CreateGameResponse,
  GameApi,
  GetGameRequest,
  GetGameResponse,
  JoinGameRequest,
  JoinGameResponse,
} from './client.js';
import { ApiError } from './client.js';

const notWired = (op: string): never => {
  throw new ApiError(
    'not_implemented',
    `${op} not yet wired — see issue #13`,
  );
};

export class RealGameApi implements GameApi {
  public readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async createGame(_req: CreateGameRequest): Promise<CreateGameResponse> {
    return notWired('POST /games');
  }

  async joinGame(_req: JoinGameRequest): Promise<JoinGameResponse> {
    return notWired('POST /games/:code/join');
  }

  async getGame(_req: GetGameRequest): Promise<GetGameResponse> {
    return notWired('GET /games/:code');
  }
}
