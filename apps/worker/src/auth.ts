// ─────────────────────────── Bearer-token seat auth ─────────────────
//
// Issue #38: GET /games/:code accepts an optional
// `Authorization: Bearer <playerToken>` header. When the bearer hashes
// to a `tokenHashes[seat]` entry for this game, the requester is
// recognised as that seat and the response unredacts their own hand.
//
// Anonymous, missing, malformed, wrong-game, or unknown tokens fall
// through silently — the GET endpoint never 401s. Bad auth just means
// "you get the public view". This matches the threat model: the GET
// is a read of an already-public board; the bearer header is purely
// to opt into seeing your own hand.

import type { Seat } from '@eoe/schema';
import type { StoredGame } from './kv-store.js';
import { sha256Hex } from './random.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * Pull a raw bearer token out of an `Authorization: Bearer <token>`
 * header. Returns `null` if the header is missing or doesn't carry the
 * Bearer scheme. The returned value is the plaintext token — NOT
 * persisted anywhere; only used to compute its sha256 below.
 */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (header === null) return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  if (token.length === 0) return null;
  return token;
}

/**
 * Given the request and a loaded `StoredGame`, return the `Seat` the
 * caller is authenticated as — or `null` if no/invalid bearer.
 *
 * Lookup is sha256(token) === tokenHashes[seat]. Same scheme as
 * post-action's body-based auth, just relocated to the Authorization
 * header. Constant-time comparison is not required: we compare a hex
 * digest of the *attacker's own* input against per-game hashes — there
 * is no plaintext secret leaking through timing.
 */
export async function verifySeatFromBearer(
  request: Request,
  stored: StoredGame,
): Promise<Seat | null> {
  const token = extractBearerToken(request);
  if (token === null) return null;
  const presented = await sha256Hex(token);
  const seats: Seat[] = [1, 2, 3, 4];
  for (const seat of seats) {
    if (stored.tokenHashes[seat] === presented) return seat;
  }
  return null;
}
