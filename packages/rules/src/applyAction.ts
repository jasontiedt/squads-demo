import type { Action, GameState, Seat } from '@eoe/schema';

import { attack } from './attack.js';
import { deployUnit } from './deployUnit.js';
import { drawAndDiscardCleanup } from './draw.js';
import { move } from './move.js';
import { isOpponentTurnAction, isPhaseLegal, nextPhase } from './phases.js';
import { playAction } from './playAction.js';
import { err, ok, type Result } from './result.js';
import { scout } from './scout.js';

// ─────────────────────────── applyAction ─────────────────────────────
//
// Issue #6: the rules engine entry point. Pure, deterministic, no I/O.
//
// Contract:
//   - Inputs are NEVER mutated. We spread a new `GameState` for any
//     transition that changes phase, turn, or activePlayer.
//   - All control flow goes through `Result<GameState>`. We never
//     throw for ruleset violations; throws are reserved for true
//     programming bugs (which the type system should already catch).
//   - Phase gating runs FIRST, before any handler logic. The gate
//     consults `ACTION_PHASE_LEGALITY` (see `./phases.ts`) — one
//     lookup, no branching tree.
//   - This issue (#6) implements gating + the EndPhase/EndTurn state
//     machine. Every other action passes through the gate and then
//     returns `{ code: 'not_implemented' }`. Effect handlers land in
//     subsequent issues (#7+).
//
// Active-seat semantics:
//   - "Active-turn" actions (everything except `PlayReaction`) must be
//     played by `state.activePlayer`. Any other seat → `not_your_turn`.
//   - `PlayReaction` is the inverse: it must be played by a NON-active
//     seat. The active player calling PlayReaction → `not_your_turn`.
//   - For now we treat "non-active" as "any seat that isn't the active
//     seat" — once full reaction windows land we'll refine to "the seat
//     in the pending reaction window".

// ─── Seat rotation ───
//
// Rotates the active seat to the next *occupied* seat (1 → 2 → 3 → 4 → 1).
// We skip empty seats so a 2-player game (seats 1 & 2 occupied) flips
// 1 ↔ 2 cleanly. Returns the next seat AND whether we wrapped past seat
// 1 (which is the signal to increment the turn counter).
//
// Determinism: relies only on the keys present in `state.players`. The
// players record uses literal-number keys 1|2|3|4.

const SEATS_IN_ORDER: ReadonlyArray<Seat> = [1, 2, 3, 4];

function rotateSeat(state: GameState): { next: Seat; wrapped: boolean } {
  const current = state.activePlayer;
  const currentIdx = SEATS_IN_ORDER.indexOf(current);

  // Walk forward up to 4 slots looking for the next occupied seat.
  // Bound the loop at 4 — anything beyond is a corrupt state and we
  // defensively fall back to keeping the current seat (caller handles
  // the no-op by treating wrapped=true so the turn still advances).
  for (let i = 1; i <= SEATS_IN_ORDER.length; i++) {
    const probeIdx = (currentIdx + i) % SEATS_IN_ORDER.length;
    const probeSeat = SEATS_IN_ORDER[probeIdx];
    if (probeSeat === undefined) continue;
    if (state.players[probeSeat] !== undefined) {
      return { next: probeSeat, wrapped: probeIdx <= currentIdx };
    }
  }

  // Solo game (only the current seat occupied). Stay on this seat but
  // signal wrap so the turn counter still ticks — useful for tests.
  return { next: current, wrapped: true };
}

// ─── End-of-turn cleanup ───
//
// Real implementation lives in `./draw.ts` (#7): draws to 5 / +1, then
// applies the hand cap of 7. Resource resets (#8) will compose into the
// same hook — likely by wrapping or chaining off `drawAndDiscardCleanup`
// so the call site below stays stable.

// ─── Main entry point ───

export function applyAction(
  state: GameState,
  action: Action,
  actorId: Seat,
): Result<GameState> {
  // 1) Active-seat / opponent-seat gate.
  const isReaction = isOpponentTurnAction(action.type);
  if (isReaction) {
    if (actorId === state.activePlayer) {
      return err(
        'not_your_turn',
        `${action.type} must be played by a non-active seat (active seat is ${state.activePlayer})`,
      );
    }
  } else {
    if (actorId !== state.activePlayer) {
      return err(
        'not_your_turn',
        `${action.type} requires the active seat (${state.activePlayer}); actor was seat ${actorId}`,
      );
    }
  }

  // 2) Phase gate. Reactions skip the phase check — they're legal in
  //    any phase as long as the actor is the non-active seat.
  if (!isReaction && !isPhaseLegal(action.type, state.phase)) {
    return err(
      'wrong_phase',
      `${action.type} is not legal during the ${state.phase} phase`,
    );
  }

  // 3) Dispatch. Only EndPhase / EndTurn have real effect logic in #6;
  //    everything else returns `not_implemented` after the gate passes.
  switch (action.type) {
    case 'EndPhase': {
      const next = nextPhase(state.phase);
      if (next === null) {
        // Should be unreachable thanks to the gate (EndPhase is illegal
        // from `end`), but we keep this defensive branch so a bug in
        // the table surfaces as a clear error rather than a crash.
        return err(
          'wrong_phase',
          `Cannot EndPhase from ${state.phase}; use EndTurn instead`,
        );
      }
      return ok({ ...state, phase: next });
    }

    case 'EndTurn': {
      const { next, wrapped } = rotateSeat(state);
      const cleaned = drawAndDiscardCleanup(state);
      const advanced: GameState = {
        ...cleaned,
        phase: 'start',
        activePlayer: next,
        turn: wrapped ? cleaned.turn + 1 : cleaned.turn,
      };

      // ─── Win condition: units-eliminated (#55) ───
      // After end-of-turn effects, if any seated player has zero units
      // AND total deployed units > 2, the game ends with the opposing
      // seat as winner. The `> 2` guard prevents instant-end at game
      // start before deployments have accumulated.
      //
      // PRECEDENCE: this check runs BEFORE the capital-HP check below.
      // When both win paths would fire on the same EndTurn (a seat
      // has zero units AND zero capital HP), units-eliminated wins
      // and we return here. Pinned in winCondition.test.ts.
      if (advanced.units.length > 2) {
        const occupiedSeats = SEATS_IN_ORDER.filter(
          (s) => advanced.players[s] !== undefined,
        );
        const wipedOut = occupiedSeats.find(
          (s) => !advanced.units.some((u) => u.owner === s),
        );
        if (wipedOut !== undefined) {
          // Winner = first occupied seat that still has units. In 2-
          // player this is unambiguous; in 3-4 player we pick the
          // first survivor by seat order (good enough for MVP-3).
          const winner = occupiedSeats.find(
            (s) => advanced.units.some((u) => u.owner === s),
          );
          if (winner !== undefined) {
            return ok({ ...advanced, phase: 'ended', winner });
          }
        }
      }

      // ─── Win condition: capital-HP (#68) ───
      // After units-eliminated misses, check capital HP. A seat is
      // "dead" when its `Player.capitalHp <= 0`. If exactly one
      // occupied seat remains alive, that seat wins.
      //
      // NOTE on field naming: issue #68 references
      // `BuildingInstance.health`, but the canonical schema stores
      // capital HP on `Player.capitalHp` (see schema/src/state.ts).
      // `BuildingInstance` only carries `damage`. We check `capitalHp`
      // as the authoritative HP source.
      //
      // 4-player corner case: if seat 3's capital hits 0 but seats
      // 1, 2, 4 are still alive, the game does NOT end — we need
      // exactly one survivor. Pinned in winCondition.test.ts.
      const occupied = SEATS_IN_ORDER.filter(
        (s) => advanced.players[s] !== undefined,
      );
      const aliveSeats = occupied.filter(
        (s) => (advanced.players[s]?.capitalHp ?? 0) > 0,
      );
      // Only end when at least one capital has died AND exactly one
      // seat survives. Without a dead capital, this turn is normal.
      if (aliveSeats.length === 1 && aliveSeats.length < occupied.length) {
        const winner = aliveSeats[0];
        if (winner !== undefined) {
          return ok({ ...advanced, phase: 'ended', winner });
        }
      }

      return ok(advanced);
    }

    // Issue #8: DeployUnit — MVP Capital-only path.
    case 'DeployUnit':
      return deployUnit(state, action, actorId);

    // Issue #85: PlayAction — Action-card resolution via typed effect
    // dispatcher. Pays cost, moves hand→discard, then routes the card's
    // `effect` payload through `effects/dispatch.ts`. Replaces the old
    // generic PlayCard handler (deleted in #85).
    case 'PlayAction':
      return playAction(state, action, actorId);

    // Issue #56: Scout — reveal a face-down tile (MVP-3, no adjacency).
    case 'Scout':
      return scout(state, action, actorId);

    // Issue #54: Attack — unit attacks another unit (MVP-3, no capital).
    case 'Attack':
      return attack(state, action, actorId);

    // Issue #67: MoveUnit — Chebyshev movement on the 6×6 board.
    case 'MoveUnit':
      return move(state, action, actorId);

    // Every other action passed the phase + seat gate but has no
    // effect implementation yet. These stubs are lifted one-by-one in
    // subsequent issues.
    case 'BuildCamp':
    case 'BuildBarracks':
    case 'RelocateBuilding':
    case 'SwitchAttackMode':
    case 'UnitAbility':
    case 'Resupply':
    case 'RecruitDraw':
    case 'PlayTactic':
    case 'PlayTechnology':
    case 'PlayUpgrade':
    case 'PlayEvent':
    case 'DiscardEvent':
    case 'PlayReaction':
      return err(
        'not_implemented',
        `${action.type} passed phase/seat gating but its effect handler is not yet implemented`,
      );

    default: {
      // Exhaustiveness check — if a new Action variant is added to the
      // schema and not handled above, TS will flag this branch.
      const _exhaustive: never = action;
      void _exhaustive;
      return err(
        'unknown_action',
        `Unrecognised action variant (this is a bug — schema and rules drifted apart)`,
      );
    }
  }
}
