import { loadCivMeta } from '@eoe/assets-meta';
import type { Action, GameState, Seat } from '@eoe/schema';
import { Effect } from '@eoe/schema';

import { dispatchEffect } from './effects/dispatch.js';
import { payCost } from './payCost.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── PlayAction (Issue #85) ──────────────────
//
// Resolve an Action card from the player's hand:
//   1. Validate the actor seat exists and owns the card in `hand`.
//   2. Look up the card in the actor's civ catalog and verify
//      `card.kind === 'action'`.
//   3. Narrow `card.effect` against the typed `Effect` discriminated
//      union (#83). Loose `z.unknown()` payloads are catalog drift —
//      surface as `effect_not_typed` rather than silently failing.
//   4. Pay the card's `cost` via `payCost` (#84). On insufficient
//      resources, the original state is returned unchanged.
//   5. Move card hand → discard.
//   6. Dispatch the typed effect via `dispatchEffect`. If the effect
//      handler errors (e.g. `not_implemented`), the WHOLE play is
//      rolled back atomically: we return the ORIGINAL pre-cost state
//      and bubble the error up. No partial application.
//
// Phase / seat gating happens upstream in `applyAction` (PlayAction is
// Deployment-only by the active seat — see `phases.ts`).
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-
// time JSON import.
//
// Version: rules engine never bumps `state.version` — that's the
// Worker's job after `applyAction` returns ok.

type PlayActionAction = Extract<Action, { type: 'PlayAction' }>;

export function playAction(
  state: GameState,
  action: PlayActionAction,
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

  // 2) Card must exist in catalog and be `kind: 'action'`.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return err(
      'card_not_in_catalog',
      `card ${action.cardId} not found in catalog for civ ${player.civ}`,
    );
  }
  if (card.kind !== 'action') {
    return err(
      'not_an_action_card',
      `card ${action.cardId} has kind '${card.kind}'; PlayAction requires an action card`,
    );
  }

  // 3) Narrow the loose `effect: z.union([Effect, z.unknown()])` against
  //    the typed `Effect` discriminated union. Catalog cards still ship
  //    placeholder strings (see assets-meta data files); those land
  //    here as `effect_not_typed` rather than crashing.
  const parsed = Effect.safeParse(card.effect);
  if (!parsed.success) {
    return err(
      'effect_not_typed',
      `card ${action.cardId} effect payload does not parse against Effect union: ${parsed.error.message}`,
    );
  }

  // 4) Pay cost. On shortfall this returns `err` AND `state` is
  //    unchanged (see payCost.ts) — we can safely return without
  //    further work.
  const paid = payCost(state, actorId, card.cost);
  if (!paid.ok) return paid;

  // 5) Move card from hand → discard on top of the post-cost state.
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

  // 6) Dispatch effect. ATOMIC ROLLBACK: if the handler errors, we
  //    return the ORIGINAL `state` so the caller sees no partial
  //    application (cost untouched, card still in hand).
  const dispatched = dispatchEffect(intermediate, parsed.data, {
    actorSeat: actorId,
    cardId: action.cardId,
  });
  if (!dispatched.ok) {
    // Rebuild the err with the same code/message — but preserve the
    // pre-play state. The Result type is immutable; just bubble the
    // err (the state isn't carried in err, so this IS the rollback —
    // the caller never sees `intermediate`).
    return dispatched;
  }
  return ok(dispatched.value);
}
