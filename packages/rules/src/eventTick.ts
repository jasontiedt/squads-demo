import type { GameState, Seat } from '@eoe/schema';

// ─────────────────────────── eventTick (Issue #100, MVP-6 S4) ────────
//
// End-of-turn helper. Decrements `ticksRemaining` on every entry in
// `state.players[seat].activeEvents`, then removes expired entries
// (counter hit zero) by moving their `cardId` into `state.players[seat].discard`.
//
// Purity: no RNG, no clock, no I/O. Returns a fresh `GameState`; the
// input is never mutated.
//
// Per the MVP-6 S4 scope lock (issue #100), this helper does NOT
// re-dispatch each event's `effect` on tick — per-tick recurring
// firing is deferred to MVP-7. Events tick down and expire; the on-play
// effect already fired at PlayEvent time.

export function eventTick(state: GameState, seat: Seat): GameState {
  const player = state.players[seat];
  if (player === undefined) return state;
  if (player.activeEvents.length === 0) return state;

  const expired: typeof player.discard = [];
  const survivors: typeof player.activeEvents = [];
  for (const evt of player.activeEvents) {
    const next = evt.ticksRemaining - 1;
    if (next <= 0) {
      expired.push(evt.cardId);
    } else {
      survivors.push({ ...evt, ticksRemaining: next });
    }
  }

  const newDiscard =
    expired.length === 0 ? player.discard : [...player.discard, ...expired];
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: {
        ...player,
        activeEvents: survivors,
        discard: newDiscard,
      },
    },
  };
}
