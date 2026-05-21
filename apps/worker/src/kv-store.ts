// ─────────────────────────── KV store ───────────────────────────────
//
// Typed read/write layer over `env.GAMES`. One KV key per game,
// formatted `game:<code>`. The stored value is JSON with the shape:
//
//   {
//     state:       GameState,        // canonical engine shape
//     tokenHashes: { 1: hex, 2?: hex, 3?: hex, 4?: hex },
//   }
//
// `version` lives on `state.version` (single source of truth — no
// duplicate). `tokenHashes` is sha256(playerToken) so the plaintext
// token never re-touches storage after issue.

import { type GameState } from '@eoe/schema';

export interface StoredGame {
  readonly state: GameState;
  readonly tokenHashes: {
    readonly 1?: string;
    readonly 2?: string;
    readonly 3?: string;
    readonly 4?: string;
  };
}

/** Build the canonical KV key for a game. */
export function gameKey(gameCode: string): string {
  return `game:${gameCode}`;
}

/** Load a stored game by code. Returns `null` if no key exists. */
export async function loadGame(
  kv: KVNamespace,
  gameCode: string,
): Promise<StoredGame | null> {
  const raw = await kv.get(gameKey(gameCode), 'text');
  if (raw === null) return null;
  return JSON.parse(raw) as StoredGame;
}

/** Persist a stored game. Overwrites any existing key. */
export async function saveGame(
  kv: KVNamespace,
  gameCode: string,
  stored: StoredGame,
): Promise<void> {
  await kv.put(gameKey(gameCode), JSON.stringify(stored));
}

/** True if a game already exists at the given code — used for code-collision avoidance. */
export async function gameExists(kv: KVNamespace, gameCode: string): Promise<boolean> {
  const raw = await kv.get(gameKey(gameCode), 'text');
  return raw !== null;
}
