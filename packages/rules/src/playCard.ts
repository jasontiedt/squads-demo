import type { Action, GameState, Seat } from '@eoe/schema';

import { drawCard } from './draw.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── playCard ────────────────────────────────
//
// Issue #36 — MVP-2 / 2.2 generic PlayCard handler.
//
// Effect (deterministic, hardcoded for MVP-2): "discard this card, then
// draw 1". Pure. No I/O. No `Math.random`. The follow-up draw uses
// `drawCard` from `./draw.ts`, which pulls positionally from the top of
// the deck (no PRNG, no reshuffle).
//
// Phase/seat gating runs upstream in `applyAction`. This handler only
// runs once the actor is `state.activePlayer` and `state.phase` is one
// of `['mobilization', 'deployment']` (see `./phases.ts`).
//
// Preconditions verified here:
//   1. The actor's player record exists (defensive — upstream catches).
//   2. The cardId is in the actor's hand. First-occurrence semantics:
//      duplicates are legal, only the first copy is consumed.
//
// Empty-deck handling: a successful PlayCard is NOT blocked by an empty
// deck. The card still moves hand → discard, the draw silently yields
// nothing. Matches the no-reshuffle rule (rulebook §"End of Turn") and
// the existing `drawAndDiscardCleanup` behavior. Pinned in tests; see
// `.squad/decisions/inbox/artoo-playcard-draw-effect.md`.
//
// Version: the rules engine never bumps `state.version` — that lives in
// the Worker after `applyAction` succeeds. The handler preserves the
// inbound version so the Worker can apply its `+1`.

type PlayCardAction = Extract<Action, { type: 'PlayCard' }>;

export function playCard(
  state: GameState,
  action: PlayCardAction,
  actorId: Seat,
): Result<GameState> {
  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  // 1) Hand membership.
  const handIdx = player.hand.indexOf(action.cardId);
  if (handIdx < 0) {
    return err(
      'card_not_in_hand',
      `card ${action.cardId} is not in seat ${actorId}'s hand`,
    );
  }

  // 2) Remove card from hand → append to discard. First-occurrence only.
  const newHand = [
    ...player.hand.slice(0, handIdx),
    ...player.hand.slice(handIdx + 1),
  ];
  const newDiscard = [...player.discard, action.cardId];

  const postPlayPlayer = {
    ...player,
    hand: newHand,
    discard: newDiscard,
  };

  const postPlayState: GameState = {
    ...state,
    players: { ...state.players, [actorId]: postPlayPlayer },
  };

  // 3) Apply the "draw 1" effect. drawCard returns the same state ref
  //    when the deck is empty — that's the no-reshuffle path, NOT an
  //    error. The PlayCard itself still succeeds.
  const drawResult = drawCard(postPlayState, actorId);
  return ok(drawResult.state);
}
