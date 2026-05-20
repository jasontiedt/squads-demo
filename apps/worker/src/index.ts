/// <reference types="@cloudflare/workers-types" />
import { applyAction } from '@eoe/rules';

// Imported to verify cross-package wiring. Artoo replaces these stubs
// with real handlers backed by KV.
void applyAction;

export interface Env {
  ALLOWED_ORIGINS: string;
  // GAMES: KVNamespace; // wire up after `wrangler kv:namespace create GAMES`
}

function corsHeaders(origin: string | null, allowed: string): HeadersInit {
  const allowList = allowed.split(',').map((s) => s.trim());
  const allowOrigin = origin && allowList.includes(origin) ? origin : allowList[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin ?? '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
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
      // Stub: Artoo wires real game creation + KV write.
      return json(
        { gameId: 'STUB01', playerToken: 'stub-token-not-secure' },
        200,
        cors,
      );
    }

    // POST /games/:id/actions — submit action
    const actionsMatch = pathname.match(/^\/games\/([^/]+)\/actions$/);
    if (request.method === 'POST' && actionsMatch) {
      return json({ error: 'not_implemented' }, 501, cors);
    }

    // GET /games/:id — read state
    const gameMatch = pathname.match(/^\/games\/([^/]+)$/);
    if (request.method === 'GET' && gameMatch) {
      return json({ error: 'not_implemented' }, 501, cors);
    }

    return json({ error: 'not_found' }, 404, cors);
  },
} satisfies ExportedHandler<Env>;
