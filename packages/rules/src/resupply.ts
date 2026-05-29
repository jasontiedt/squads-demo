import type { Action, GameState, Player, Seat } from '@eoe/schema';

import { err, ok, type Result } from './result.js';

type ResupplyAction = Extract<Action, { type: 'Resupply' }>;

// @needs-confirmation: rulebook OCR has not yet confirmed the discard
// cost. MVP-7 pins Resupply at discarding the top 1 card from deck.
export const RESUPPLY_DISCARD_COUNT = 1 as const;

export function resupply(
  state: GameState,
  action: ResupplyAction,
  actorId: Seat,
): Result<GameState> {
  // Action payload is currently unused: MVP-7 Resupply operates on the
  // actor's existing resource tokens only. Keep the parameter wired so a
  // future rule can validate or consume `unitId` without changing the
  // handler signature.
  void action;

  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  if (player.deck.length < RESUPPLY_DISCARD_COUNT) {
    return err(
      'deck_too_thin',
      `Resupply requires discarding ${RESUPPLY_DISCARD_COUNT} card from deck; seat ${actorId} has only ${player.deck.length}`,
    );
  }

  const refreshedResources = player.resources.map((resource) =>
    resource.exhausted ? { ...resource, exhausted: false } : resource,
  );
  const discarded = player.deck.slice(0, RESUPPLY_DISCARD_COUNT);

  const nextPlayer: Player = {
    ...player,
    deck: player.deck.slice(RESUPPLY_DISCARD_COUNT),
    discard: [...player.discard, ...discarded],
    resources: refreshedResources,
  };

  return ok({
    ...state,
    players: { ...state.players, [actorId]: nextPlayer },
  });
}
