import { loadCivMeta } from '@eoe/assets-meta';
import type { Action, ActiveEvent, GameState, Seat } from '@eoe/schema';
import { Effect } from '@eoe/schema';

import { dispatchEffect } from './effects/dispatch.js';
import { payCost } from './payCost.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── PlayEvent (Issue #100, MVP-6 S4) ────────
//
// Resolve an Event card from the player's hand. Mirrors
// `playTactic.ts` / `playAction.ts` (#85, #86) — same atomic flow,
// different card kind. Events differ in three ways:
//
//   1) HARD CAP. Each player's `activeEvents` list is capped at 3
//      (rulebook §"Events"). When at-cap, this handler returns
//      `event_cap_reached` BEFORE paying cost — the engine NEVER
//      auto-discards an existing event to make room. Cap pressure is
//      the caller's problem (UI nudges player to discard manually).
//
//   2) PERSISTENT. Unlike Action/Tactic, an event does NOT go from
//      hand → discard. It moves hand → `activeEvents` with a fresh
//      `ticksRemaining` counter (read from the catalog card). The
//      end-of-turn `eventTick` helper decrements that counter for the
//      owner; expired events flow into `discard`.
//
//   3) ON-PLAY EFFECT. The card's typed `effect` is dispatched ONCE,
//      at play time, with the same atomic-rollback semantics as
//      Action/Tactic. Per-tick recurring effect firing is OUT OF
//      SCOPE for MVP-6 and deferred to MVP-7 — for now, an event sits
//      on the field counting down, but only its on-play effect fires.
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-
// time JSON import.

type PlayEventAction = Extract<Action, { type: 'PlayEvent' }>;

export function playEvent(
  state: GameState,
  action: PlayEventAction,
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

  // 2) Card must exist in catalog and be `kind: 'event'`.
  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === action.cardId);
  if (card === undefined) {
    return err(
      'card_not_in_catalog',
      `card ${action.cardId} not found in catalog for civ ${player.civ}`,
    );
  }
  if (card.kind !== 'event') {
    return err(
      'not_an_event_card',
      `card ${action.cardId} has kind '${card.kind}'; PlayEvent requires an event card`,
    );
  }

  // 3) HARD CAP. Reject before paying cost. The rulebook is explicit
  //    that there is no auto-discard rule.
  const activeCount = player.activeEvents.length;
  if (activeCount >= 3) {
    return err(
      'event_cap_reached',
      `seat ${actorId} already has ${activeCount} active events; cap is 3`,
    );
  }

  // 4) Narrow `card.effect` against typed `Effect`. Loose payloads
  //    (catalog drift) surface as `effect_not_typed`. Catalog backfill
  //    landed alongside this handler — see byzantines.json events.
  const parsed = Effect.safeParse(card.effect);
  if (!parsed.success) {
    return err(
      'effect_not_typed',
      `card ${action.cardId} effect payload does not parse against Effect union: ${parsed.error.message}`,
    );
  }

  // 5) Pay cost. On shortfall, `state` is unchanged — bail untouched.
  const paid = payCost(state, actorId, card.cost);
  if (!paid.ok) return paid;

  // 6) Move card from hand → `activeEvents` (NOT to discard — events
  //    are persistent). The catalog `ticksRemaining` is read once and
  //    stored on the runtime entry; subsequent decrements happen via
  //    `eventTick`.
  const postCostPlayer = paid.value.players[actorId];
  if (postCostPlayer === undefined) {
    return err('not_your_turn', `seat ${actorId} disappeared after payCost (defensive)`);
  }
  const newHand = [
    ...postCostPlayer.hand.slice(0, handIdx),
    ...postCostPlayer.hand.slice(handIdx + 1),
  ];
  const newEntry: ActiveEvent = {
    cardId: action.cardId,
    ticksRemaining: card.ticksRemaining,
    effect: parsed.data,
  };
  const newActiveEvents = [...postCostPlayer.activeEvents, newEntry];
  const intermediate: GameState = {
    ...paid.value,
    players: {
      ...paid.value.players,
      [actorId]: {
        ...postCostPlayer,
        hand: newHand,
        activeEvents: newActiveEvents,
      },
    },
  };

  // 7) Dispatch on-play effect. ATOMIC ROLLBACK: on err, bubble — the
  //    caller never sees `intermediate`, so cost stays unpaid and the
  //    card stays in hand from the caller's perspective.
  const dispatched = dispatchEffect(intermediate, parsed.data, {
    actorSeat: actorId,
    cardId: action.cardId,
  });
  if (!dispatched.ok) return dispatched;
  return ok(dispatched.value);
}
