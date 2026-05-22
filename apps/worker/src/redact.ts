// ─────────────────────────── State redaction ────────────────────────
//
// Issue #13: GET /games/:id and POST /games/:id/actions return the
// post-action `GameState` to clients. Hands are private — a player
// MUST NOT see another player's hand contents. We redact every hand to
// its size only (`{ count: N }`) before sending state over the wire.
//
// Issue #38: a Bearer-token-authenticated GET unredacts the requester's
// OWN hand. The acting seat on POST /actions likewise sees their own
// hand back (it's freshly mutated — the client needs the new cardIds).
// `redactStateForSeat(state, seat)` keeps that one seat's `hand:
// CardId[]` and redacts everyone else to `{ count }`. The wire shape is
// a union: `hand: { count: number } | readonly CardId[]`. Anonymous
// callers still get the fully-redacted view via `redactStateForPublic`.
//
// All other state (decks, discards, units, buildings, resources, map,
// moveLog) is fully public for MVP-2. Deck composition is technically
// hidden in a real card game but our deck is shuffled deterministically
// from a known catalog + seed; we'll lift `deck` into a count later if
// real anti-cheat matters.

import type { CardId, GameState, Player, Seat } from '@eoe/schema';

/**
 * Wire view of a player. `hand` is EITHER the opaque size descriptor
 * (opponent view) OR the real card-id array (the requester's own seat
 * under a valid bearer / the acting seat on POST /actions).
 */
export interface PublicPlayer extends Omit<Player, 'hand'> {
  readonly hand: { readonly count: number } | readonly CardId[];
}

/**
 * Wire view of game state. `players[seat].hand` may be either shape
 * per the union above; the caller knows which seat (if any) holds the
 * unredacted form because they presented the matching bearer / they
 * just submitted the action.
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
 * Pass a player through unredacted (hand: CardId[]) but cast into the
 * wider wire shape so it composes with redacted opponents in the same
 * map. No copy — the caller already treats GameState as immutable.
 */
function unredactedPlayer(player: Player): PublicPlayer {
  // `Player.hand` is `CardId[]`, which is assignable to the
  // `readonly CardId[]` arm of the union.
  return player as unknown as PublicPlayer;
}

/**
 * Redact `state.players[*].hand` for all occupied seats. Other fields
 * are passed through by reference — the engine treats GameState as
 * immutable so sharing references is safe.
 */
export function redactStateForPublic(state: GameState): PublicGameState {
  return redactStateForSeat(state);
}

/**
 * Issue #38: redact every seat's hand EXCEPT `requesterSeat`, whose
 * `hand: CardId[]` is passed through. Pass `undefined` (or omit) for
 * a fully-redacted public view (equivalent to `redactStateForPublic`).
 */
export function redactStateForSeat(
  state: GameState,
  requesterSeat?: Seat,
): PublicGameState {
  const players: PublicGameState['players'] = {};
  const seats: Seat[] = [1, 2, 3, 4];
  for (const seat of seats) {
    const p = state.players[seat];
    if (p === undefined) continue;
    (players as Record<Seat, PublicPlayer>)[seat] =
      seat === requesterSeat ? unredactedPlayer(p) : redactPlayer(p);
  }
  return { ...state, players };
}
