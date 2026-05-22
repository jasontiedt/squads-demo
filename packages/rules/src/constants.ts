// ─────────────────────────── Game constants ────────────────────────
//
// Pure value constants consumed by the initial-state factory and the
// rules engine. Kept here (not in `@eoe/schema`) because they are
// engine knobs — schema validates *shape*, not seeded starting values.
//
// Source: rulebook §"Setup" line 77 (base game capital HP = 10) and
// §"Long Game" line 324 (long game capital HP = 20). MVP-3 issue #57
// pins long-game HP as the default; revisit if a base-game toggle is
// added.

/** Capital starting HP. Long-game default per rulebook §324. */
export const CAPITAL_DEFAULT_HP = 20;

/** Cards dealt to each player at game start — rulebook §"Setup". */
export const STARTING_HAND_SIZE = 5;

/**
 * Minimum deck size after the opening hand is drawn. Pads the catalog
 * with civ-namespaced placeholders if the real catalog is short
 * (mid-MVP placeholder; replaced when full civ data ships).
 */
export const MIN_DECK_AFTER_DRAW = 7;
