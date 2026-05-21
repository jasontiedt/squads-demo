// ─────────────────────────── POST /games/:code/actions ──────────────
//
// Issue #13: submit an action against an existing game under optimistic
// versioning.
//
// Contract:
//   Request body (PostActionBody): { seat, token, expectedVersion, action }
//
//   Worker pipeline:
//     1. Parse body with Zod (rejects malformed action shapes at the
//        edge, before any KV access). Schema validation of the Action
//        discriminated union runs here — `not_implemented` action types
//        still pass schema (they're in the union), they fail later at
//        the rules engine.
//     2. Load `game:<code>` from KV → 404 if missing.
//     3. Auth: `sha256(token) === tokenHashes[seat]` → 401 if not.
//     4. Version: `state.version === expectedVersion` → 409 if not,
//        body includes `{ code: 'version_mismatch', current, expected }`
//        so the client can re-GET and retry.
//     5. Engine: `applyAction(state, action, seat)`. On err →
//        400 `{ code, error }` carrying the engine's RuleError code.
//     6. Bump `state.version += 1`, write back to KV.
//     7. Return `200 { state: redactedNext, version: newVersion }`.
//
// KV race-condition caveat: writes are NOT transactional. Two clients
// posting against the same `expectedVersion` could both pass the check
// and both write — last write wins, version bumps once instead of
// twice. Acceptable for 2-player turn-based MVP (rare collision, the
// loser sees a 409 on their NEXT action). Documented in the optimistic-
// versioning decision and flagged `@needs-confirmation` for a follow-up
// issue that moves to Durable Objects when MVP graduates.

import { applyAction } from '@eoe/rules';
import { errorBody, json } from '../http.js';
import { loadGame, saveGame } from '../kv-store.js';
import { sha256Hex } from '../random.js';
import { redactStateForPublic } from '../redact.js';
import { PostActionBody } from '../request-schema.js';

export async function handleActions(
  request: Request,
  kv: KVNamespace,
  gameCode: string,
  cors: HeadersInit,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(errorBody('invalid_json', 'Request body must be valid JSON.'), 400, cors);
  }

  const parsed = PostActionBody.safeParse(raw);
  if (!parsed.success) {
    return json(
      errorBody('invalid_body', 'Request body failed validation.', parsed.error.flatten()),
      400,
      cors,
    );
  }
  const { seat, token, expectedVersion, action } = parsed.data;

  const stored = await loadGame(kv, gameCode);
  if (stored === null) {
    return json(errorBody('not_found', `No game with code ${gameCode}.`), 404, cors);
  }

  // 1) Auth. Never trust the caller's `seat` against the token —
  //    re-verify by hashing the supplied plaintext token and matching
  //    against the stored hash for that seat. A wrong seat (correct
  //    token for a different seat) fails here, not at the rules layer.
  const storedHash = stored.tokenHashes[seat];
  if (storedHash === undefined) {
    return json(errorBody('unauthorized', 'Invalid token for seat.'), 401, cors);
  }
  const presentedHash = await sha256Hex(token);
  if (presentedHash !== storedHash) {
    return json(errorBody('unauthorized', 'Invalid token for seat.'), 401, cors);
  }

  // 2) Optimistic version gate. Mismatch → 409 with the current value
  //    so the client can refetch and retry.
  if (stored.state.version !== expectedVersion) {
    return json(
      {
        code: 'version_mismatch',
        error: 'State has moved on; refetch and retry.',
        current: stored.state.version,
        expected: expectedVersion,
      },
      409,
      cors,
    );
  }

  // 3) Engine. applyAction returns a Result<GameState>; any rules error
  //    becomes a structured 400 carrying the engine's error code.
  const result = applyAction(stored.state, action, seat);
  if (!result.ok) {
    return json(
      { code: result.error.code, error: result.error.message },
      400,
      cors,
    );
  }

  // 4) Bump version, persist, respond.
  const nextState = { ...result.value, version: stored.state.version + 1 };
  await saveGame(kv, gameCode, { ...stored, state: nextState });

  return json(
    { state: redactStateForPublic(nextState), version: nextState.version },
    200,
    cors,
  );
}
