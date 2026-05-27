import type { GameState, Seat } from '@eoe/schema';

import { closeReactionWindow } from './reactionWindow.js';
import { err, ok, type Result } from './result.js';

// ─────────────────────────── PassReaction (Issue #101) ───────────────
//
// MVP-6 S5: explicit pass on an open reaction window. The eligible seat
// declines to play a Reaction; the window closes and the active seat
// resumes.
//
// No cost. No card. No effect dispatch. Only:
//   1. A reaction window must be open.
//   2. The actor must equal `pendingReactionWindow.eligibleSeat`.
//   3. Close the window.
//
// Seat-vs-active-player gating ran upstream in `applyAction` via
// `isOpponentTurnAction` (PassReaction is opponent-turn, parallel to
// PlayReaction).
//
// Determinism: no RNG, no clock, no I/O.

export function passReaction(
  state: GameState,
  actorId: Seat,
): Result<GameState> {
  // 1) Window must be open.
  const window = state.pendingReactionWindow;
  if (window === undefined) {
    return err(
      'no_window_open',
      `PassReaction requires an open pendingReactionWindow; none is set`,
    );
  }

  // 2) Actor must be the eligible seat.
  if (actorId !== window.eligibleSeat) {
    return err(
      'not_eligible_seat',
      `seat ${actorId} is not the eligible seat for this reaction window (eligible: ${window.eligibleSeat})`,
    );
  }

  // 3) Close the window. State otherwise untouched.
  return ok(closeReactionWindow(state));
}
