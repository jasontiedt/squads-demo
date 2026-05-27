import { loadCivMeta } from '@eoe/assets-meta';
import type { Action, GameState, Seat } from '@eoe/schema';

import { dispatchEffect } from './effects/dispatch.js';
import { payCost } from './payCost.js';
import { closeReactionWindow } from './reactionWindow.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── PlayReaction (Issue #101) ───────────────
//
// MVP-6 S5: resolve a Reaction card from the eligible seat's hand in
// response to an open `state.pendingReactionWindow`.
//
// Flow (mirrors `playAction.ts` / `playTactic.ts`, with reaction gates
// in front of the cost/effect pipeline):
//   1. A reaction window must be open (`state.pendingReactionWindow`).
//   2. The actor must equal `pendingReactionWindow.eligibleSeat`.
//      Seat-vs-active-player gating (reactions are opponent-windowed)
//      already ran upstream in `applyAction` via `isOpponentTurnAction`.
//   3. The card must be in the actor's hand.
//   4. The card must exist in catalog and be `kind: 'reaction'`. The
//      Reaction card schema (#101) carries a typed `trigger` + typed
//      `Effect` — no `effect_not_typed` path: the schema enforces it.
//   5. The card's `trigger.kind` must match the window's `trigger.kind`.
//      We compare ONLY the discriminator at this layer — sub-filters
//      (e.g. `minDamage`, `unitClass`) are reserved for a later slice.
//   6. Pay the card's `cost` via `payCost`. On shortfall the original
//      state is returned unchanged.
//   7. Move card hand → discard on top of the post-cost state.
//   8. Dispatch the reaction's `effect` via `dispatchEffect`. ATOMIC
//      ROLLBACK: if the handler errors, return the ORIGINAL pre-cost
//      state (no partial application — cost untouched, card still in
//      hand, window still open).
//   9. Close the reaction window.
//
// L2/L3 (Wedge lock): reactions NEVER emit triggers. This handler does
// NOT call `openReactionWindow` — only the active seat's action path
// in `applyAction.ts` does.
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-
// time JSON import.

type PlayReactionAction = Extract<Action, { type: 'PlayReaction' }>;

export function playReaction(
  state: GameState,
  action: PlayReactionAction,
  actorId: Seat,
): Result<GameState> {
  // 1) Reaction window must be open.
  const window = state.pendingReactionWindow;
  if (window === undefined) {
    return err(
      'no_window_open',
      `PlayReaction requires an open pendingReactionWindow; none is set`,
    );
  }

  // 2) Actor must be the eligible seat.
  if (actorId !== window.eligibleSeat) {
    return err(
      'not_eligible_seat',
      `seat ${actorId} is not the eligible seat for this reaction window (eligible: ${window.eligibleSeat})`,
    );
  }

  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_eligible_seat',
      `no player seated at ${actorId} (defensive — eligibility check should catch this)`,
    );
  }

  // 3) Card must be in hand. First-occurrence semantics (duplicates ok).
  const handIdx = player.hand.indexOf(action.cardId);
  if (handIdx < 0) {
    return err(
      'card_not_in_hand',
      `card ${action.cardId} is not in seat ${actorId}'s hand`,
    );
  }

  // 4) Card must exist in catalog and be `kind: 'reaction'`.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return err(
      'card_not_in_catalog',
      `card ${action.cardId} not found in catalog for civ ${player.civ}`,
    );
  }
  if (card.kind !== 'reaction') {
    return err(
      'not_a_reaction',
      `card ${action.cardId} has kind '${card.kind}'; PlayReaction requires a reaction card`,
    );
  }

  // 5) Trigger kind must match the window's trigger kind. (Sub-filter
  //    refinement — minDamage, unitClass, etc. — is reserved for a
  //    future slice; S5 matches on the discriminator only.)
  if (card.trigger.kind !== window.trigger.kind) {
    return err(
      'trigger_mismatch',
      `reaction ${action.cardId} trigger '${card.trigger.kind}' does not match window trigger '${window.trigger.kind}'`,
    );
  }

  // 6) Pay cost. On shortfall payCost returns err AND `state` is
  //    unchanged — we can safely return without further work.
  const paid = payCost(state, actorId, card.cost);
  if (!paid.ok) return paid;

  // 7) Move card hand → discard on top of the post-cost state.
  const postCostPlayer = paid.value.players[actorId];
  if (postCostPlayer === undefined) {
    // Unreachable — payCost preserves player records.
    return err(
      'not_eligible_seat',
      `seat ${actorId} disappeared after payCost (defensive)`,
    );
  }
  const newHand = [
    ...postCostPlayer.hand.slice(0, handIdx),
    ...postCostPlayer.hand.slice(handIdx + 1),
  ];
  const newDiscard = [...postCostPlayer.discard, action.cardId];
  const intermediate: GameState = {
    ...paid.value,
    players: {
      ...paid.value.players,
      [actorId]: { ...postCostPlayer, hand: newHand, discard: newDiscard },
    },
  };

  // 8) Dispatch effect. ATOMIC ROLLBACK on handler error: we return
  //    the err itself (which carries no state), so the caller sees no
  //    partial application — the original `state` is preserved.
  const dispatched = dispatchEffect(intermediate, card.effect, {
    actorSeat: actorId,
    cardId: action.cardId,
  });
  if (!dispatched.ok) return dispatched;

  // 9) Close the reaction window.
  return ok(closeReactionWindow(dispatched.value));
}
