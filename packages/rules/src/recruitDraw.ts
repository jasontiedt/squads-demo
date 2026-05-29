import type { Action, GameState, Seat } from '@eoe/schema';

import { applyHandCap, drawCard } from './draw.js';
import { err, ok, type Result } from './result.js';

type RecruitDrawAction = Extract<Action, { type: 'RecruitDraw' }>;

export function recruitDraw(
  state: GameState,
  action: RecruitDrawAction,
  actorId: Seat,
): Result<GameState> {
  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  const count = action.payload.count;

  if (player.deck.length < count) {
    return err(
      'deck_empty',
      `RecruitDraw needs ${count} card(s) but deck has ${player.deck.length}`,
    );
  }

  let working = state;
  for (let i = 0; i < count; i++) {
    const next = drawCard(working, actorId);
    working = next.state;
  }

  return ok(applyHandCap(working, actorId));
}
