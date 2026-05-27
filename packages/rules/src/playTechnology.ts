import { loadCivMeta } from '@eoe/assets-meta';
import type { Action, GameState, Seat } from '@eoe/schema';
import { Effect } from '@eoe/schema';

import { dispatchEffect } from './effects/dispatch.js';
import { payCost } from './payCost.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── PlayTechnology (Issue #99 — MVP-6 S3) ───
//
// Resolve a Technology card from the player's hand. Mirrors
// `playAction.ts` (#85) and `playTactic.ts` (#86) — same atomic flow
// (cost → hand→discard → dispatch).
//
// Technologies are Deployment-only by the active seat. Phase / seat
// gating happens upstream in `applyAction`. There is no per-card
// `playableIn` narrowing (unlike Tactics), no target field on the
// action (unlike PlayUpgrade) — Technology effects (`class-wide-passive`)
// carry their own selector via `classFilter` + `ownership`.
//
// Technology cards still carry `effect: z.unknown()` in the schema
// (catalog migration deferred). We narrow against the typed `Effect`
// union; loose payloads surface as `effect_not_typed`.
//
// Permanence: per MVP-6 scope, `class-wide-passive` registrations are
// append-only — Technologies do NOT leave play. The hand→discard move
// keeps the catalog id off the deck and out of the hand, but the
// passive entry persists in `state.classWidePassives` for the rest of
// the game.
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-
// time JSON import.

type PlayTechnologyAction = Extract<Action, { type: 'PlayTechnology' }>;

export function playTechnology(
  state: GameState,
  action: PlayTechnologyAction,
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

  // 2) Card must exist in catalog and be `kind: 'technology'`.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return err(
      'card_not_in_catalog',
      `card ${action.cardId} not found in catalog for civ ${player.civ}`,
    );
  }
  if (card.kind !== 'technology') {
    return err(
      'not_a_technology',
      `card ${action.cardId} has kind '${card.kind}'; PlayTechnology requires a technology card`,
    );
  }

  // 3) Narrow loose `effect: z.unknown()` to the typed Effect union.
  const parsed = Effect.safeParse(card.effect);
  if (!parsed.success) {
    return err(
      'effect_not_typed',
      `card ${action.cardId} effect payload does not parse against Effect union: ${parsed.error.message}`,
    );
  }

  // 4) Pay cost. On shortfall this returns `err` AND `state` is
  //    unchanged — bail with the err untouched.
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

  // 6) Dispatch effect. ATOMIC ROLLBACK: on err, bubble the err — the
  //    caller never sees `intermediate`, so cost is effectively unpaid
  //    and card stays in hand from the caller's perspective.
  const dispatched = dispatchEffect(intermediate, parsed.data, {
    actorSeat: actorId,
    cardId: action.cardId,
  });
  if (!dispatched.ok) return dispatched;
  return ok(dispatched.value);
}
