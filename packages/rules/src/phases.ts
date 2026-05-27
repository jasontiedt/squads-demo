import { ACTION_TYPES, type ActionType, type TurnPhase } from '@eoe/schema';

// ─────────────────────────── Phase legality table ────────────────────
//
// Issue #6: every action has a fixed set of legal phases. The table
// below is the single source of truth — `applyAction` does one lookup
// before touching any handler.
//
// Phase legality keyed off `state.phase` (one of `TurnPhase`). The
// special marker `'opponent-turn'` is used for `PlayReaction`, which
// is legal in any phase BUT must be played by the non-active seat.
// `applyAction` consults this marker after the phase lookup to decide
// whose turn the action belongs to.
//
// Why a static table?
//   - One lookup, deterministic, no branching tree.
//   - Trivial to test exhaustively (every `ActionType` × every
//     `TurnPhase`).
//   - New actions force a TS error here when added to `ACTION_TYPES`
//     because the `Record<ActionType, ...>` type is exhaustive.
//
// Phase mapping (rulebook §"Turn Structure" + wedge-rulebook-synthesis):
//   - `start`        : no player actions; only `EndPhase` advances to
//                      Mobilization. The Start phase is a bookkeeping
//                      step (unexhaust resources/units). Players cannot
//                      move, build, attack, or deploy in `start`.
//   - `mobilization` : board actions (move/build/attack/etc.) +
//                      `PlayTactic` (Tactic cards are legal in both
//                      phases per rulebook).
//   - `deployment`   : card-spending actions (deploy units, play
//                      Technology / Upgrade / Action / Event) +
//                      `PlayTactic`. No board movement here.
//   - `end`          : end-of-turn cleanup; only `EndTurn` is legal.
//
// Reactions (`PlayReaction`) are legal whenever the OPPONENT is acting,
// regardless of phase. We mark them with the `opponent-turn` literal
// rather than listing every phase — semantics differ from the
// active-seat lookup.

export type PhaseLegality = TurnPhase | 'opponent-turn';

export const ACTION_PHASE_LEGALITY: Readonly<Record<ActionType, ReadonlyArray<PhaseLegality>>> = {
  // ─── Mobilization phase ───
  MoveUnit: ['mobilization'],
  Scout: ['mobilization'],
  BuildCamp: ['mobilization'],
  BuildBarracks: ['mobilization'],
  RelocateBuilding: ['mobilization'],
  Attack: ['mobilization'],
  SwitchAttackMode: ['mobilization'],
  UnitAbility: ['mobilization'],
  Resupply: ['mobilization'],
  RecruitDraw: ['mobilization'],
  // Tactic: legal in BOTH Mobilization and Deployment.
  PlayTactic: ['mobilization', 'deployment'],

  // ─── Deployment phase ───
  DeployUnit: ['deployment'],
  PlayTechnology: ['deployment'],
  PlayUpgrade: ['deployment'],
  PlayAction: ['deployment'],
  PlayEvent: ['deployment'],
  DiscardEvent: ['deployment'],

  // PlayCard (MVP-2 / #36) was removed in #85; PlayAction (above)
  // replaces it as the typed action-card play.

  // ─── Opponent's turn (reaction window) ───
  // Legal whenever the OPPONENT holds the active turn; phase irrelevant.
  // MVP-6 S5 (#101): PassReaction parallels PlayReaction — explicit
  // pass to close the open reaction window without playing a card.
  PlayReaction: ['opponent-turn'],
  PassReaction: ['opponent-turn'],

  // ─── Phase control ───
  // EndPhase walks start → mobilization → deployment → end.
  // From `end`, EndPhase is ILLEGAL — players must use EndTurn to
  // advance to the next seat (resetting phase to `start`).
  EndPhase: ['start', 'mobilization', 'deployment'],
  // EndTurn is only legal from the `end` phase. From any other phase
  // players must EndPhase their way to `end` first.
  EndTurn: ['end'],
};

// Compile-time sanity: ensure the table covers every action type. If a
// new variant is added to `ACTION_TYPES` and forgotten here, this line
// fails to typecheck because the record type would be incomplete.
const _exhaustivenessCheck: ReadonlyArray<ActionType> = ACTION_TYPES;
void _exhaustivenessCheck;

// ─────────────────────────── Phase progression ───────────────────────
//
// Linear walk through the four phases. `EndPhase` from `end` is NOT
// permitted (callers must use `EndTurn`); this helper therefore returns
// `null` for `end` and the gate rejects it with `wrong_phase`.

const PHASE_ORDER: ReadonlyArray<TurnPhase> = ['start', 'mobilization', 'deployment', 'end'];

/**
 * Returns the phase that follows `current` within a single player's
 * turn, or `null` if `current` is `end` (no further phase — the player
 * must call `EndTurn`).
 */
export function nextPhase(current: TurnPhase): TurnPhase | null {
  const idx = PHASE_ORDER.indexOf(current);
  // Defensive: unknown phase falls through to null. Shouldn't happen
  // for parsed `GameState` values since `TurnPhase` is a Zod enum.
  if (idx < 0 || idx >= PHASE_ORDER.length - 1) return null;
  // `idx + 1` is in range because of the bound check above; non-null
  // assertion would still be banned by team conventions, so re-read.
  const next = PHASE_ORDER[idx + 1];
  return next ?? null;
}

/**
 * Returns true if `action` is legal in `phase` purely on phase grounds.
 * Reactions (`opponent-turn`) are NOT covered here — callers must check
 * the `opponent-turn` marker separately against actor vs active seat.
 */
export function isPhaseLegal(action: ActionType, phase: TurnPhase): boolean {
  const legal = ACTION_PHASE_LEGALITY[action];
  return legal.includes(phase);
}

/** Returns true if `action` is a reaction-class action (opponent-turn). */
export function isOpponentTurnAction(action: ActionType): boolean {
  return ACTION_PHASE_LEGALITY[action].includes('opponent-turn');
}
