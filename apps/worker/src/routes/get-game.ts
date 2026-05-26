// ─────────────────────────── GET /games/:code ───────────────────────
//
// Issues #13, #38, #88: read a game's current state.
//
// Auth model:
//   • No `Authorization` header → public, fully-redacted state. Hands
//     come back as `{ count }`. Same shape MVP-1 always returned.
//   • `Authorization: Bearer <playerToken>` where sha256(token) matches
//     a `tokenHashes[seat]` for THIS game → the requester's own hand
//     comes through as `CardId[]`. Opponents stay redacted.
//   • Anything else (malformed header, wrong-game token, unknown
//     token) silently falls back to the public view. GET never 401s
//     when `?seat=` is absent — the public board is world-readable;
//     the bearer is purely an opt-in for "let me also see my hand."
//
// Issue #88 — `?seat=N` query param:
//   • Explicit opt-in: caller asserts "I am seat N, unredact it."
//   • `N` must be 1–4; otherwise → 400 `bad_request`.
//   • Bearer MUST hash to `tokenHashes[N]`; otherwise → 401
//     `unauthorized` (token missing/malformed/wrong-game/wrong-seat).
//   • On success, seat N's hand is unredacted; all other seats stay
//     redacted. `seat: N` echoes in the response body.
//
// Returns:
//   • 200 `{ state, version, seat? }` — `seat` is set when a valid
//     bearer was presented (either via `?seat=N` or seat auto-detect).
//   • 400 `{ code: 'bad_request', ... }` when `?seat=` is out of range.
//   • 401 `{ code: 'unauthorized', ... }` when `?seat=N` is given but
//     the bearer doesn't match that seat.
//   • 404 `{ code: 'not_found', ... }` when the game doesn't exist.

import type { Seat } from '@eoe/schema';
import { errorBody, json } from '../http.js';
import { loadGame } from '../kv-store.js';
import { redactStateForSeat } from '../redact.js';
import { verifySeatFromBearer } from '../auth.js';

const VALID_SEATS: readonly Seat[] = [1, 2, 3, 4];

/**
 * Parse `?seat=N` from the request URL.
 *   • returns `{ kind: 'absent' }` if not present
 *   • returns `{ kind: 'valid', seat }` if it parses to 1–4
 *   • returns `{ kind: 'invalid' }` otherwise (non-numeric, out of range)
 */
function parseSeatParam(
  request: Request,
): { kind: 'absent' } | { kind: 'valid'; seat: Seat } | { kind: 'invalid' } {
  const raw = new URL(request.url).searchParams.get('seat');
  if (raw === null) return { kind: 'absent' };
  // Reject anything that isn't a clean integer string (e.g. "1.5", "0x1", "01").
  if (!/^[1-9][0-9]*$/.test(raw)) return { kind: 'invalid' };
  const n = Number.parseInt(raw, 10);
  if (!VALID_SEATS.includes(n as Seat)) return { kind: 'invalid' };
  return { kind: 'valid', seat: n as Seat };
}

export async function handleGetGame(
  request: Request,
  kv: KVNamespace,
  gameCode: string,
  cors: HeadersInit,
): Promise<Response> {
  const seatParam = parseSeatParam(request);
  if (seatParam.kind === 'invalid') {
    return json(
      errorBody('bad_request', 'Query param `seat` must be an integer in 1..4.'),
      400,
      cors,
    );
  }

  const stored = await loadGame(kv, gameCode);
  if (stored === null) {
    return json(errorBody('not_found', `No game with code ${gameCode}.`), 404, cors);
  }

  const bearerSeat = await verifySeatFromBearer(request, stored);

  // Issue #88: explicit `?seat=N` — bearer must match that seat exactly.
  if (seatParam.kind === 'valid') {
    if (bearerSeat !== seatParam.seat) {
      return json(
        errorBody(
          'unauthorized',
          `Bearer token does not match seat ${seatParam.seat}.`,
        ),
        401,
        cors,
      );
    }
    const state = redactStateForSeat(stored.state, seatParam.seat);
    return json(
      { state, version: stored.state.version, seat: seatParam.seat },
      200,
      cors,
    );
  }

  // Issue #38 legacy path: no `?seat=` → bearer auto-unredacts its own seat
  // (or anonymous → fully redacted).
  const state = redactStateForSeat(stored.state, bearerSeat ?? undefined);
  if (bearerSeat !== null) {
    return json({ state, version: stored.state.version, seat: bearerSeat }, 200, cors);
  }
  return json({ state, version: stored.state.version }, 200, cors);
}
