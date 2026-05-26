import { loadCivMeta } from '@eoe/assets-meta';
import type { Action, GameState, Seat, TacticPhase } from '@eoe/schema';
import { Effect } from '@eoe/schema';

import { dispatchEffect } from './effects/dispatch.js';
import { payCost } from './payCost.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── PlayTactic (Issue #86) ──────────────────
//
// Resolve a Tactic card from the player's hand. Mirrors `playAction.ts`
// (#85) — same atomic flow, different card kind. Tactics are unique in
// that they are legal in BOTH `mobilization` AND `deployment`; per-card
// `playableIn` narrows that further.
//
// Flow:
//   1. Validate the actor seat exists and owns the card in `hand`.
//   2. Look up the card in the actor's civ catalog and verify
//      `card.kind === 'tactic'`.
//   3. Confirm the current phase is listed in `card.playableIn`.
//   4. Narrow `card.effect` against the typed `Effect` discriminated
//      union (#83). Loose `z.unknown()` payloads (catalog drift, pre-#87)
//      surface as `effect_not_typed`.
//   5. Pay the card's `cost` via `payCost` (#84). On insufficient
//      resources, the original state is returned unchanged.
//   6. Move card hand → discard.
//   7. Dispatch the typed effect via `dispatchEffect`. ATOMIC ROLLBACK:
//      if the handler errors, the original pre-cost state is returned
//      (the caller never sees the intermediate hand/discard mutation).
//
// `applyAction` (#6) handles the Mobilization-OR-Deployment phase gate
// at the action-type level; this handler tightens to the per-card
// `playableIn` restriction.
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-
// time JSON import.

type PlayTacticAction = Extract<Action, { type: 'PlayTactic' }>;

export function playTactic(
  state: GameState,
  action: PlayTacticAction,
  actorId: Seat,
): Result<GameState> {
  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  // 1) Card must be in hand. First-occurrence semantics (duplicates ok).
  const handIdx = player.hand.indexOf(action.cardId);
  if (handIdx < 0) {
    return err(
      'card_not_in_hand',
      `card ${action.cardId} is not in seat ${actorId}'s hand`,
    );
  }

  // 2) Card must exist in catalog and be `kind: 'tactic'`.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return err(
      'card_not_in_catalog',
      `card ${action.cardId} not found in catalog for civ ${player.civ}`,
    );
  }
  if (card.kind !== 'tactic') {
    return err(
      'not_a_tactic',
      `card ${action.cardId} has kind '${card.kind}'; PlayTactic requires a tactic card`,
    );
  }

  // 3) Per-card `playableIn` gate. `applyAction` already restricted
  //    `state.phase` to mob/deployment before reaching us, so the cast
  //    is safe. Tactics with `playableIn: ['deployment']` reject in
  //    mobilization here (and vice versa).
  const currentPhase = state.phase as TacticPhase;
  if (!card.playableIn.includes(currentPhase)) {
    return err(
      'wrong_phase',
      `tactic ${action.cardId} is not playable in phase '${state.phase}' (allowed: ${card.playableIn.join(', ')})`,
    );
  }

  // 4) Narrow loose `effect: z.union([Effect, z.unknown()])` to typed
  //    Effect. Stub effects (string payloads in catalog data) surface
  //    as `effect_not_typed` until #87 migrates catalog cards.
  const parsed = Effect.safeParse(card.effect);
  if (!parsed.success) {
    return err(
      'effect_not_typed',
      `card ${action.cardId} effect payload does not parse against Effect union: ${parsed.error.message}`,
    );
  }

  // 5) Pay cost. On shortfall this returns `err` AND `state` is
  //    unchanged — bail with the err untouched.
  const paid = payCost(state, actorId, card.cost);
  if (!paid.ok) return paid;

  // 6) Move card from hand → discard on top of the post-cost state.
  const postCostPlayer = paid.value.players[actorId];
  if (postCostPlayer === undefined) {
    // Unreachable — payCost preserves player records.
    return err('not_your_turn', `seat ${actorId} disappeared after payCost (defensive)`);
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

  // 7) Dispatch effect. ATOMIC ROLLBACK: on err, bubble the err — the
  //    caller never sees `intermediate`, so cost is effectively unpaid
  //    and card stays in hand from the caller's perspective.
  const dispatched = dispatchEffect(intermediate, parsed.data, {
    actorSeat: actorId,
    cardId: action.cardId,
  });
  if (!dispatched.ok) return dispatched;
  return ok(dispatched.value);
}
