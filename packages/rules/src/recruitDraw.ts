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

  const count = action.payload?.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    return err('unknown_action', 'RecruitDraw requires payload.count >= 1');
  }

  if (player.deck.length < count) {
    return err(
      'deck_empty',
      `RecruitDraw needs ${count} card(s) but deck has ${player.deck.length}`,
    );
  }

  let working = state;
  for (let i = 0; i < count; i++) {
    const next = drawCard(working, actorId);
    if (next.drawn === null) {
      return err('deck_empty', `deck is empty during RecruitDraw (draw ${i + 1} of ${count})`);
    }
    working = next.state;
  }

  return ok(applyHandCap(working, actorId));
}
