// ─────────────────────────── GET /games/:code ───────────────────────
//
// Issues #13, #38: read a game's current state.
//
// Auth model:
//   • No `Authorization` header → public, fully-redacted state. Hands
//     come back as `{ count }`. Same shape MVP-1 always returned.
//   • `Authorization: Bearer <playerToken>` where sha256(token) matches
//     a `tokenHashes[seat]` for THIS game → the requester's own hand
//     comes through as `CardId[]`. Opponents stay redacted.
//   • Anything else (malformed header, wrong-game token, unknown
//     token) silently falls back to the public view. GET never 401s —
//     the public board is, by design, world-readable; the bearer is
//     purely an opt-in for "let me also see my hand."
//
// Returns:
//   • 200 `{ state, version, seat? }` — `seat` is set only when a
//     valid bearer was presented, letting the client confirm which
//     player it is in this game without storing seat alongside token.
//   • 404 `{ code: 'not_found', ... }` when the game doesn't exist.

import { errorBody, json } from '../http.js';
import { loadGame } from '../kv-store.js';
import { redactStateForSeat } from '../redact.js';
import { verifySeatFromBearer } from '../auth.js';

export async function handleGetGame(
  request: Request,
  kv: KVNamespace,
  gameCode: string,
  cors: HeadersInit,
): Promise<Response> {
  const stored = await loadGame(kv, gameCode);
  if (stored === null) {
    return json(errorBody('not_found', `No game with code ${gameCode}.`), 404, cors);
  }
  const seat = await verifySeatFromBearer(request, stored);
  const state = redactStateForSeat(stored.state, seat ?? undefined);
  if (seat !== null) {
    return json({ state, version: stored.state.version, seat }, 200, cors);
  }
  return json({ state, version: stored.state.version }, 200, cors);
}
