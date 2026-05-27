import { loadCivMeta } from '@eoe/assets-meta';
import type { Action, GameState, Seat } from '@eoe/schema';
import { Effect } from '@eoe/schema';

import { dispatchEffect } from './effects/dispatch.js';
import { payCost } from './payCost.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── PlayUpgrade (Issue #99 — MVP-6 S3) ──────
//
// Resolve an Upgrade card from the player's hand, attaching it to a
// specific deployed unit. Mirrors `playAction.ts` (#85) and
// `playTactic.ts` (#86) — same atomic flow (cost → hand→discard →
// dispatch), with two Upgrade-specific gates:
//
//   • `targetUnitId` must reference a deployed unit owned by the actor.
//     Upgrades historically attach to OWN units only at the card-rules
//     layer (the effect dispatcher itself is ownership-agnostic — see
//     `effects/attachKeyword.ts` header). Pinned here at the handler.
//   • If the catalog card sets `restrictedToClass`, the target unit's
//     card class set must intersect that list. Otherwise the play
//     fails with `upgrade_class_mismatch`.
//
// Upgrade cards still carry `effect: z.unknown()` in the schema
// (catalog migration deferred — see `cards.ts` header). We narrow
// against the typed `Effect` union; loose string payloads surface as
// `effect_not_typed`, matching the playAction/playTactic precedent.
//
// Effect target rewrite: the canonical Upgrade verb is `attach-keyword`,
// whose schema requires `target.unitId: UnitInstanceId`. Catalog data
// cannot know the instance id ahead of time — it's chosen by the
// player at play time. So when the parsed effect is `attach-keyword`,
// we overwrite `effect.target.unitId` with `action.targetUnitId`
// before dispatching. Other effect kinds (e.g. a future targeted
// buff) pass through unchanged — the catalog payload wins.
//
// Phase / seat gating happens upstream in `applyAction` (PlayUpgrade is
// Deployment-only by the active seat — see `phases.ts`).
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-
// time JSON import.

type PlayUpgradeAction = Extract<Action, { type: 'PlayUpgrade' }>;

export function playUpgrade(
  state: GameState,
  action: PlayUpgradeAction,
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

  // 2) Card must exist in catalog and be `kind: 'upgrade'`.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return err(
      'card_not_in_catalog',
      `card ${action.cardId} not found in catalog for civ ${player.civ}`,
    );
  }
  if (card.kind !== 'upgrade') {
    return err(
      'not_an_upgrade',
      `card ${action.cardId} has kind '${card.kind}'; PlayUpgrade requires an upgrade card`,
    );
  }

  // 3) Target unit must exist and be owned by the actor.
  const targetUnit = state.units.find((u) => u.id === action.targetUnitId);
  if (targetUnit === undefined) {
    return err(
      'target_not_found',
      `unit ${action.targetUnitId} is not on the board`,
    );
  }
  if (targetUnit.owner !== actorId) {
    return err(
      'target_not_yours',
      `unit ${action.targetUnitId} is not owned by seat ${actorId}`,
    );
  }

  // 4) If the upgrade is class-restricted, the target's card class set
  //    must intersect. We look up the target's catalog card via the
  //    actor's civ catalog — Upgrades attach to own units, so the
  //    actor's catalog is the right scope.
  if (card.restrictedToClass !== undefined && card.restrictedToClass.length > 0) {
    const targetCard = catalog.find((c) => c.id === targetUnit.cardId);
    if (targetCard === undefined || targetCard.kind !== 'unit') {
      // Defensive: a deployed unit whose card isn't in catalog or
      // isn't a unit card indicates state drift. Surface as the same
      // class-mismatch code rather than introducing a new one.
      return err(
        'upgrade_class_mismatch',
        `cannot resolve class of target unit ${action.targetUnitId} for class-restricted upgrade`,
      );
    }
    const overlap = targetCard.class.some((c) =>
      card.restrictedToClass!.includes(c),
    );
    if (!overlap) {
      return err(
        'upgrade_class_mismatch',
        `upgrade ${action.cardId} restricted to [${card.restrictedToClass.join(', ')}]; target unit class is [${targetCard.class.join(', ')}]`,
      );
    }
  }

  // 5) Narrow loose `effect: z.unknown()` to the typed Effect union.
  //    Stub/string payloads in catalog data surface here.
  const parsed = Effect.safeParse(card.effect);
  if (!parsed.success) {
    return err(
      'effect_not_typed',
      `card ${action.cardId} effect payload does not parse against Effect union: ${parsed.error.message}`,
    );
  }

  // 6) For attach-keyword (the canonical Upgrade verb), rewrite the
  //    catalog-provided unitId with the action's targetUnitId. Other
  //    effect kinds pass through — the catalog payload is authoritative
  //    for non-attach-keyword Upgrades.
  const effect: Effect =
    parsed.data.kind === 'attach-keyword'
      ? {
          ...parsed.data,
          target: { kind: 'unit', unitId: action.targetUnitId },
        }
      : parsed.data;

  // 7) Pay cost. On shortfall this returns `err` AND `state` is
  //    unchanged — bail with the err untouched.
  const paid = payCost(state, actorId, card.cost);
  if (!paid.ok) return paid;

  // 8) Move card from hand → discard on top of the post-cost state.
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

  // 9) Dispatch effect. ATOMIC ROLLBACK: on err, bubble the err — the
  //    caller never sees `intermediate`, so cost is effectively unpaid
  //    and card stays in hand from the caller's perspective.
  const dispatched = dispatchEffect(intermediate, effect, {
    actorSeat: actorId,
    cardId: action.cardId,
  });
  if (!dispatched.ok) return dispatched;
  return ok(dispatched.value);
}
