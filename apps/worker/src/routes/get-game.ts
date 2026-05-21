// ─────────────────────────── GET /games/:code ───────────────────────
//
// Issue #13: read a game's current public state. No token required —
// the response is hand-redacted (`redactStateForPublic`), so leaking
// the URL only leaks the public board view (resources, units,
// buildings, hand SIZES). Hand contents stay private.
//
// Returns:
//   • 200 `{ state: PublicGameState, version: N }`
//   • 404 `{ code: 'not_found', ... }` when the game doesn't exist

import { errorBody, json } from '../http.js';
import { loadGame } from '../kv-store.js';
import { redactStateForPublic } from '../redact.js';

export async function handleGetGame(
  _request: Request,
  kv: KVNamespace,
  gameCode: string,
  cors: HeadersInit,
): Promise<Response> {
  const stored = await loadGame(kv, gameCode);
  if (stored === null) {
    return json(errorBody('not_found', `No game with code ${gameCode}.`), 404, cors);
  }
  const publicState = redactStateForPublic(stored.state);
  return json({ state: publicState, version: stored.state.version }, 200, cors);
}
