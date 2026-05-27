// ─────────────────────────── @eoe/rules entry ───────────────────────
//
// Pure, deterministic rules engine for Echoes of Emperors. Imported by
// both the Cloudflare Worker (server-side validation) and the web app
// (optimistic UI). Must stay free of I/O, randomness, and time.

export { applyAction } from './applyAction.js';
export { attack } from './attack.js';
export {
    CAPITAL_DEFAULT_HP,
    MIN_DECK_AFTER_DRAW,
    STARTING_HAND_SIZE,
} from './constants.js';
export { deployUnit } from './deployUnit.js';
export { drawAndDiscardCleanup, drawCard, type DrawResult } from './draw.js';
export { eventTick } from './eventTick.js';
export { addJoiner, buildCreatorState } from './initialState.js';
export { chebyshev, move } from './move.js';
export {
    ACTION_PHASE_LEGALITY,
    isOpponentTurnAction,
    isPhaseLegal,
    nextPhase,
    type PhaseLegality
} from './phases.js';
export { payCost } from './payCost.js';
export { playAction } from './playAction.js';
export { playTactic } from './playTactic.js';
export { playTechnology } from './playTechnology.js';
export { playUpgrade } from './playUpgrade.js';
export { effectiveStats, type EffectiveStats } from './effectiveStats.js';
export { playEvent } from './playEvent.js';
export { dispatchEffect, type EffectContext } from './effects/dispatch.js';
export { capitalOf, tileOfSquare, unitsFor, unitsOnTile } from './queries.js';
export { scout } from './scout.js';
export { err, ok, type Result, type RuleError, type RuleErrorCode } from './result.js';
export { mulberry32, seedFor } from './rng.js';
export { shuffleWith } from './shuffle.js';

