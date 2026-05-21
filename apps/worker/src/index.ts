/// <reference types="@cloudflare/workers-types" />
//
// ─────────────────────────── Worker entry point ──────────────────────
//
// Routing layer. Real game logic lives in the route handlers under
// `./routes/`. The Worker owns I/O (KV, randomness, request parsing);
// `@eoe/rules` stays a pure engine.

import { corsHeaders, errorBody, json } from './http.js';
import { handleCreateGame } from './routes/create-game.js';
import { handleJoinGame } from './routes/join-game.js';
import { handleActions } from './routes/post-action.js';
import { handleGetGame } from './routes/get-game.js';

export interface Env {
  ALLOWED_ORIGINS: string;
  GAMES: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env.ALLOWED_ORIGINS);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // POST /games — create a new game
    if (request.method === 'POST' && pathname === '/games') {
      return handleCreateGame(request, env.GAMES, cors);
    }

    // POST /games/:code/join — second player joins
    const joinMatch = pathname.match(/^\/games\/([^/]+)\/join$/);
    if (request.method === 'POST' && joinMatch) {
      const code = joinMatch[1] ?? '';
      return handleJoinGame(request, env.GAMES, code, cors);
    }

    // POST /games/:id/actions — submit action (#13)
    const actionsMatch = pathname.match(/^\/games\/([^/]+)\/actions$/);
    if (request.method === 'POST' && actionsMatch) {
      const code = actionsMatch[1] ?? '';
      return handleActions(request, env.GAMES, code, cors);
    }

    // GET /games/:id — read state (#13)
    const gameMatch = pathname.match(/^\/games\/([^/]+)$/);
    if (request.method === 'GET' && gameMatch) {
      const code = gameMatch[1] ?? '';
      return handleGetGame(request, env.GAMES, code, cors);
    }

    return json(errorBody('not_found', `No route for ${request.method} ${pathname}.`), 404, cors);
  },
} satisfies ExportedHandler<Env>;
