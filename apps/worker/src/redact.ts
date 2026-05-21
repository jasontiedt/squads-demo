// ─────────────────────────── State redaction ────────────────────────
//
// Issue #13: GET /games/:id and POST /games/:id/actions both return
// the post-action `GameState` to clients. Hands are private — a player
// MUST NOT see another player's hand contents. We redact every hand to
// its size only (`{ count: N }`) before sending state over the wire.
//
// MVP-1 simplification: redact ALL hands regardless of the requesting
// seat. A follow-up issue will add a token-authenticated `?seat=X` view
// that unredacts the requesting player's own hand. Until then, even the
// owning player only sees their hand size — they already know their own
// hand contents client-side from the original create/join response and
// from action responses going forward; treating the live KV view as
// "everyone's hand is opaque" keeps the worker code simple and avoids
// a token-on-GET requirement.
//
// All other state (decks, discards, units, buildings, resources, map,
// moveLog) is fully public for MVP-1. Deck composition is technically
// hidden in a real card game but our deck is shuffled deterministically
// from a known catalog + seed; we'll lift `deck` into a count later if
// real anti-cheat matters.

import type { GameState, Player, Seat } from '@eoe/schema';

/**
 * Public view of a player — same as `Player` but `hand` is replaced
 * with an opaque size descriptor.
 */
export interface PublicPlayer extends Omit<Player, 'hand'> {
  readonly hand: { readonly count: number };
}

/**
 * Public view of game state — same as `GameState` but every player's
 * hand is redacted.
 */
export interface PublicGameState extends Omit<GameState, 'players'> {
  readonly players: {
    readonly 1?: PublicPlayer;
    readonly 2?: PublicPlayer;
    readonly 3?: PublicPlayer;
    readonly 4?: PublicPlayer;
  };
}

/** Replace a single player's `hand: CardId[]` with `{ count }`. */
function redactPlayer(player: Player): PublicPlayer {
  const { hand, ...rest } = player;
  return { ...rest, hand: { count: hand.length } };
}

/**
 * Redact `state.players[*].hand` for all occupied seats. Other fields
 * are passed through by reference — the engine treats GameState as
 * immutable so sharing references is safe.
 */
export function redactStateForPublic(state: GameState): PublicGameState {
  const players: PublicGameState['players'] = {};
  const seats: Seat[] = [1, 2, 3, 4];
  for (const seat of seats) {
    const p = state.players[seat];
    if (p !== undefined) {
      (players as Record<Seat, PublicPlayer>)[seat] = redactPlayer(p);
    }
  }
  return { ...state, players };
}
