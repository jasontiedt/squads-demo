import type { CardId, GameState, Player, Seat } from '@eoe/schema';

// ─────────────────────────── Deck draw & hand-cap ────────────────────
//
// Issue #7: implements card draw and the end-of-turn cleanup hook
// reserved by Artoo in #6 (`drawAndDiscardCleanup`).
//
// Rulebook constraints (per `wedge-rulebook-synthesis.md`):
//   • Hard hand cap: 7 cards.
//   • Decks are NO-RESHUFFLE — when empty, draws simply yield nothing.
//   • End-of-turn rule for the active player:
//       - if hand.length < 5  → draw until hand reaches 5 (or deck runs dry)
//       - else (hand ≥ 5)     → draw +1 card (or 0 if deck is empty)
//     Then if hand > 7, discard to 7.
//
// Determinism: this module is pure. Draws are positional (top of deck);
// hand-cap discards are positional (end of hand). No `Math.random`, no
// `Date.now`, no I/O. Identical inputs always produce identical outputs.
// See `./rng.ts` for the seeded PRNG primitive future effect handlers
// can opt into.

const HAND_TARGET = 5;
const HAND_CAP = 7;

export interface DrawResult {
  readonly state: GameState;
  readonly drawn: CardId | null;
}

/**
 * Draw a single card for the given seat. Top of the deck (`deck[0]`) is
 * the next-to-draw — popping from the front matches the rulebook's
 * "draw a card" verb.
 *
 * Returns `drawn: null` and an unchanged state when the deck is empty.
 * Per the rulebook there is NO reshuffle from the discard pile; the
 * player simply does not draw.
 *
 * If the seat is unoccupied (which the engine should never request),
 * we degrade gracefully and return null.
 */
export function drawCard(state: GameState, seat: Seat): DrawResult {
  const player = state.players[seat];
  if (player === undefined) return { state, drawn: null };
  if (player.deck.length === 0) return { state, drawn: null };

  const drawn = player.deck[0];
  // Narrowing guard — `length > 0` ⇒ `deck[0]` is defined, but
  // `noUncheckedIndexedAccess` requires the explicit check.
  if (drawn === undefined) return { state, drawn: null };

  const nextPlayer: Player = {
    ...player,
    deck: player.deck.slice(1),
    hand: [...player.hand, drawn],
  };
  return {
    state: { ...state, players: { ...state.players, [seat]: nextPlayer } },
    drawn,
  };
}

/**
 * End-of-turn cleanup for `state.activePlayer` — the seat that just
 * finished its turn. Three steps in order:
 *
 *   1. Compute draw count: `hand < 5` ⇒ refill to 5; else +1.
 *   2. Draw up to that many cards. Stop early when the deck empties.
 *   3. If hand > 7, move the excess from the end of the hand to the
 *      discard pile until hand.length === 7.
 *
 * @needs-confirmation: When hand > 7 at end of turn, the rulebook does
 * NOT specify which cards to discard. Default chosen here: discard from
 * the END of the hand (so the player keeps the cards they have held
 * longest, including newly drawn cards earlier in the sequence). This
 * is a deliberate guess — a future test in #9's rules-correctness suite
 * should pin this interpretation and the design forum should confirm
 * whether the rulebook intends player choice instead.
 *
 * Pure: returns a new GameState. Input is never mutated.
 */
export function drawAndDiscardCleanup(state: GameState): GameState {
  const seat = state.activePlayer;
  const player = state.players[seat];
  if (player === undefined) return state;

  const drawCount =
    player.hand.length < HAND_TARGET ? HAND_TARGET - player.hand.length : 1;

  let working: GameState = state;
  for (let i = 0; i < drawCount; i++) {
    const next = drawCard(working, seat);
    if (next.drawn === null) break; // deck empty — no reshuffle, stop.
    working = next.state;
  }

  const after = working.players[seat];
  if (after === undefined) return working;
  if (after.hand.length <= HAND_CAP) return working;

  // @needs-confirmation: positional discard from end of hand.
  const kept = after.hand.slice(0, HAND_CAP);
  const overflow = after.hand.slice(HAND_CAP);
  const trimmed: Player = {
    ...after,
    hand: kept,
    discard: [...after.discard, ...overflow],
  };
  return { ...working, players: { ...working.players, [seat]: trimmed } };
}
