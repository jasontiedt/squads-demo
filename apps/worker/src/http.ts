// ─────────────────────────── HTTP helpers ───────────────────────────
//
// CORS + JSON response helpers, kept in one place so route handlers
// stay focused on game logic.

/**
 * Build CORS headers. `env.ALLOWED_ORIGINS` is a comma-separated
 * allow-list; the response echoes the request `Origin` only if it
 * appears in the list, otherwise falls back to the first entry (or `*`
 * when the list is empty).
 */
export function corsHeaders(origin: string | null, allowed: string): HeadersInit {
  const allowList = allowed
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const allowOrigin =
    origin !== null && allowList.includes(origin)
      ? origin
      : allowList[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** JSON response with CORS + Content-Type baked in. */
export function json(body: unknown, status: number, headers: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

/** Structured error body shape — `{ error, code }`. */
export interface WorkerErrorBody {
  readonly error: string;
  readonly code: string;
  readonly details?: unknown;
}

export function errorBody(code: string, error: string, details?: unknown): WorkerErrorBody {
  return details === undefined ? { code, error } : { code, error, details };
}
