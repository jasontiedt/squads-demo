// ─────────────────────────── POST /games ────────────────────────────
//
// Creator endpoint. Validates body, generates a unique gameCode,
// builds the seat-1-only initial state, hashes the issued token, and
// persists `{ state, tokenHashes: { 1 } }` to KV.

import { errorBody, json } from '../http.js';
import { buildCreatorState } from '../game-init.js';
import { gameExists, saveGame } from '../kv-store.js';
import { newGameCode, newPlayerToken, newSeed, sha256Hex } from '../random.js';
import { redactStateForSeat } from '../redact.js';
import { CreateGameBody } from '../request-schema.js';
import { type Seed } from '@eoe/schema';

/** Maximum collision-retry budget when generating a gameCode. */
const CODE_COLLISION_RETRIES = 5;

export async function handleCreateGame(
  request: Request,
  kv: KVNamespace,
  cors: HeadersInit,
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(errorBody('invalid_json', 'Request body must be valid JSON.'), 400, cors);
  }

  const parsed = CreateGameBody.safeParse(raw);
  if (!parsed.success) {
    return json(
      errorBody('invalid_body', 'Request body failed validation.', parsed.error.flatten()),
      400,
      cors,
    );
  }
  const { civ } = parsed.data;

  // Generate a fresh gameCode with collision retries. 32^6 ≈ 1B codes
  // → collisions are vanishingly rare, but we still check so a clash
  // never silently overwrites someone's game.
  let gameCode: string | null = null;
  for (let i = 0; i < CODE_COLLISION_RETRIES; i++) {
    const candidate = newGameCode();
    if (!(await gameExists(kv, candidate))) {
      gameCode = candidate;
      break;
    }
  }
  if (gameCode === null) {
    return json(
      errorBody('code_collision', 'Could not allocate a unique game code.'),
      503,
      cors,
    );
  }

  const seed = newSeed() as Seed;
  const state = buildCreatorState(gameCode, seed, civ);

  const playerToken = newPlayerToken();
  const tokenHash = await sha256Hex(playerToken);

  await saveGame(kv, gameCode, {
    state,
    tokenHashes: { 1: tokenHash },
  });

  // Issue #38: include the redacted state with the creator's own hand
  // visible (CardId[]). Saves the client a follow-up GET round-trip.
  const stateForCreator = redactStateForSeat(state, 1);
  return json(
    { gameCode, playerToken, seat: 1, state: stateForCreator, version: state.version },
    200,
    cors,
  );
}
