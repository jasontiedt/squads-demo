import type {
  CardId,
  GameState,
  ReactionCard,
  ReactionTrigger,
  Seat,
  TriggerContext,
} from '@eoe/schema';
import { Card } from '@eoe/schema';
import { loadCivMeta } from '@eoe/assets-meta';

// ─────────────────────────── Reaction Window (Issue #101) ────────────
//
// MVP-6 S5: a singular "opponent reaction window" on the GameState
// (`state.pendingReactionWindow`). The architecture is intentionally
// minimal — see `.squad/decisions.md` "Reaction architecture (MVP-6 S5)"
// for the locked design:
//
//   L1 — Closed trigger taxonomy: exactly 5 trigger kinds, no string
//        identifiers, no plugin verbs. Defined in `@eoe/schema`.
//   L2 — Singular window, not a stack: at most ONE open window at any
//        time. Subsequent trigger emissions while a window is open
//        are silently DROPPED (this file: `openReactionWindow`).
//   L3 — No nesting: reactions never emit triggers. `playReaction`
//        does NOT call `openReactionWindow`. Only `applyAction` does,
//        and only after PlayAction success.
//   L4 — Server owns dispatch (worker concern, not modelled here).
//   L5 — No new Effect verb: reactions reuse the existing typed
//        `Effect` discriminated union (see `effects/dispatch.ts`).
//
// This module is pure helpers — open / eligible / close. The PlayReaction
// handler lives in `./playReaction.ts`. Trigger emission sites live in
// `./applyAction.ts`.
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-time
// JSON import.

/**
 * Open a reaction window on the state. NO-OP if a window is already
 * open — this is L2 (singular window) and L3 (no nesting) enforcement
 * combined: an in-flight reaction window cannot be replaced or
 * stacked. The original state is returned unchanged.
 *
 * The caller is responsible for choosing `eligibleSeat` (always the
 * non-active seat for opponent-windowed reactions).
 *
 * `deadline` is intentionally omitted — MVP-6 S5 does not implement
 * time-bounded reaction windows; the field is reserved in the schema
 * for future use.
 */
export function openReactionWindow(
  state: GameState,
  trigger: ReactionTrigger,
  triggerContext: TriggerContext,
  eligibleSeat: Seat,
): GameState {
  if (state.pendingReactionWindow !== undefined) {
    // L2/L3: silently drop. The active window is canonical.
    return state;
  }
  return {
    ...state,
    pendingReactionWindow: {
      trigger,
      triggerContext,
      eligibleSeat,
    },
  };
}

/**
 * Close the open reaction window (clears `state.pendingReactionWindow`).
 * Safe to call when no window is open — returns state unchanged.
 *
 * Called by:
 *   - `playReaction` on successful resolution.
 *   - `applyAction` PassReaction handler.
 */
export function closeReactionWindow(state: GameState): GameState {
  if (state.pendingReactionWindow === undefined) return state;
  const { pendingReactionWindow: _drop, ...rest } = state;
  void _drop;
  return rest;
}

/**
 * Given an open window and a seat, return the reaction cards in that
 * seat's hand whose `trigger.kind` matches the window's trigger.
 *
 * Returns an empty array when:
 *   - No window is open.
 *   - The seat is not the window's `eligibleSeat` (only the eligible
 *     seat can act on the window).
 *   - The seat has no matching reaction cards in hand.
 *
 * Filtering is strictly by `trigger.kind` — finer-grained predicates
 * (e.g. `OnDamageDealtTrigger.minDamage`) are NOT consulted here. UI
 * layers may further narrow the result; the rules engine resolves
 * card-specific predicates inside the dispatch path.
 */
export function eligibleReactions(
  state: GameState,
  seat: Seat,
): ReadonlyArray<ReactionCard> {
  const window = state.pendingReactionWindow;
  if (window === undefined) return [];
  if (window.eligibleSeat !== seat) return [];

  const player = state.players[seat];
  if (player === undefined) return [];

  const catalog = loadCivMeta(player.civ);
  const matches: ReactionCard[] = [];
  for (const cardId of player.hand) {
    const card = findCard(catalog, cardId);
    if (card === undefined) continue;
    if (card.kind !== 'reaction') continue;
    if (card.trigger.kind === window.trigger.kind) {
      matches.push(card);
    }
  }
  return matches;
}

// ─── helpers ───

function findCard(
  catalog: ReadonlyArray<Card>,
  cardId: CardId,
): Card | undefined {
  return catalog.find((c) => c.id === cardId);
}
