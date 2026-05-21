// ─────────────────────────── @eoe/rules entry ───────────────────────
//
// Pure, deterministic rules engine for Echoes of Emperors. Imported by
// both the Cloudflare Worker (server-side validation) and the web app
// (optimistic UI). Must stay free of I/O, randomness, and time.

export { applyAction } from './applyAction.js';
export { deployUnit } from './deployUnit.js';
export { drawAndDiscardCleanup, drawCard, type DrawResult } from './draw.js';
export {
    ACTION_PHASE_LEGALITY,
    isOpponentTurnAction,
    isPhaseLegal,
    nextPhase,
    type PhaseLegality
} from './phases.js';
export { err, ok, type Result, type RuleError, type RuleErrorCode } from './result.js';
export { mulberry32, seedFor } from './rng.js';

