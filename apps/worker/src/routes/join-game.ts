// ─────────────────────────── POST /games/:code/join ─────────────────
//
// Joiner endpoint. Looks up the game by code, rejects if missing or
// already full (seat 2 occupied), folds the joiner into the state, and
// persists `{ state(version bumped), tokenHashes: { 1, 2 } }`.

import { errorBody, json } from '../http.js';
import { addJoiner } from '../game-init.js';
import { loadGame, saveGame } from '../kv-store.js';
import { newPlayerToken, sha256Hex } from '../random.js';
import { redactStateForSeat } from '../redact.js';
import { JoinGameBody } from '../request-schema.js';

export async function handleJoinGame(
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

  const parsed = JoinGameBody.safeParse(raw);
  if (!parsed.success) {
    return json(
      errorBody('invalid_body', 'Request body failed validation.', parsed.error.flatten()),
      400,
      cors,
    );
  }

  const stored = await loadGame(kv, gameCode);
  if (stored === null) {
    return json(errorBody('not_found', `No game with code ${gameCode}.`), 404, cors);
  }
  if (stored.state.players[2] !== undefined) {
    return json(
      errorBody('game_full', 'Game already has a second player.'),
      409,
      cors,
    );
  }

  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);

  const nextState = addJoiner(stored.state, parsed.data.civ);
  await saveGame(kv, gameCode, {
    state: nextState,
    tokenHashes: { ...stored.tokenHashes, 2: tokenHash },
  });

  // Issue #38: include the redacted state with the joiner's own hand
  // visible (CardId[]). Saves the client a follow-up GET round-trip.
  const stateForJoiner = redactStateForSeat(nextState, 2);
  return json(
    { gameCode, playerToken, seat: 2, state: stateForJoiner, version: nextState.version },
    200,
    cors,
  );
}
