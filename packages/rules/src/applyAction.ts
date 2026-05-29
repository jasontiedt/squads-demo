import type { Action, GameState, Seat } from '@eoe/schema';

import { attack } from './attack.js';
import { deployUnit } from './deployUnit.js';
import { drawAndDiscardCleanup } from './draw.js';
import { eventTick } from './eventTick.js';
import { move } from './move.js';
import { passReaction } from './passReaction.js';
import { isOpponentTurnAction, isPhaseLegal, nextPhase } from './phases.js';
import { playAction } from './playAction.js';
import { playEvent } from './playEvent.js';
import { playReaction } from './playReaction.js';
import { openReactionWindow } from './reactionWindow.js';
import { playTactic } from './playTactic.js';
import { playTechnology } from './playTechnology.js';
import { playUpgrade } from './playUpgrade.js';
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

      // Issue #86: strip temporary buffs with `expires: 'end-of-turn'`
      // from every unit. Applied to ALL units (not just the active
      // seat's) because debuffs can target enemy units; "until end of
      // turn" canonically means the current player's EndTurn regardless
      // of unit ownership. See needs-confirmation test in
      // playTactic.test.ts for the pinned interpretation.
      const unitsAfterBuffCleanup = cleaned.units.map((u) => {
        if (u.temporaryBuffs === undefined || u.temporaryBuffs.length === 0) {
          return u;
        }
        const kept = u.temporaryBuffs.filter((b) => b.expires !== 'end-of-turn');
        if (kept.length === u.temporaryBuffs.length) return u;
        // Drop the field entirely when empty — matches the optional-
        // convention used elsewhere (avoids stable-snapshot churn).
        const { temporaryBuffs: _drop, ...rest } = u;
        void _drop;
        return kept.length === 0 ? rest : { ...rest, temporaryBuffs: kept };
      });

      // ─── Event tick (#100, MVP-6 S4) ───
      // Decrement `ticksRemaining` on every entry in the ENDING seat's
      // `activeEvents`. Expired events (counter → 0) flow into discard.
      // Per-tick recurring effect firing is deferred to MVP-7.
      const tickedState = eventTick(
        { ...cleaned, units: unitsAfterBuffCleanup },
        state.activePlayer,
      );

      const advanced: GameState = {
        ...tickedState,
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

    // Issue #86: PlayTactic — parallel to PlayAction for Tactic cards.
    // Same atomic pay → discard → dispatch flow, with an additional
    // per-card `playableIn` check (Tactics may restrict to mobilization
    // OR deployment even though the action-type gate accepts both).
    case 'PlayTactic':
      return playTactic(state, action, actorId);

    // Issue #99 (MVP-6 S3): PlayUpgrade — attach an Upgrade card to a
    // deployed unit. Same atomic pay → discard → dispatch flow as
    // PlayAction/PlayTactic, plus target-unit ownership + class-
    // restriction gates.
    case 'PlayUpgrade':
      return playUpgrade(state, action, actorId);

    // Issue #99 (MVP-6 S3): PlayTechnology — register a class-wide
    // passive. No action-level target — the effect carries its own
    // selector (classFilter + ownership).
    case 'PlayTechnology':
      return playTechnology(state, action, actorId);

    // Issue #100 (MVP-6 S4): PlayEvent — persistent event resolution.
    // Mirrors PlayAction/PlayTactic atomic flow but the card lands in
    // `Player.activeEvents` (cap 3) instead of discard, and the on-play
    // effect dispatches once. Per-turn ticking is handled by
    // `eventTick` from the EndTurn cleanup chain above.
    case 'PlayEvent':
      return playEvent(state, action, actorId);

    // Issue #56: Scout — reveal a face-down tile (MVP-3, no adjacency).
    case 'Scout':
      return scout(state, action, actorId);

    // Issue #54: Attack — unit or capital attack. A successful hit opens
    // the opponent's `on-damage-dealt` reaction window.
    case 'Attack': {
      const attacked = attack(state, action, actorId);
      if (!attacked.ok) return attacked;
      const eligibleSeat =
        action.targetUnitId !== undefined
          ? state.units.find((unit) => unit.id === action.targetUnitId)?.owner
          : state.buildings.find((building) => building.id === action.targetBuildingId)?.owner;
      if (eligibleSeat === undefined) return attacked;
      return ok(
        openReactionWindow(
          attacked.value,
          { kind: 'on-damage-dealt' },
          {
            actionType: 'Attack',
            actorSeat: actorId,
            ...(action.targetUnitId !== undefined
              ? { targetUnitId: action.targetUnitId }
              : { targetBuildingId: action.targetBuildingId }),
          },
          eligibleSeat,
        ),
      );
    }

    // Issue #67: MoveUnit — Chebyshev movement on the 6×6 board.
    case 'MoveUnit':
      return move(state, action, actorId);

    // Issue #101 (MVP-6 S5): PlayReaction — opponent-turn reaction
    // resolution. Validates window + eligibility + trigger match, then
    // pays cost, discards, dispatches effect, closes window.
    case 'PlayReaction':
      return playReaction(state, action, actorId);

    // Issue #101 (MVP-6 S5): PassReaction — explicit pass on the open
    // reaction window. Closes the window; no cost, no effect.
    case 'PassReaction':
      return passReaction(state, actorId);

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
    case 'DiscardEvent':
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
