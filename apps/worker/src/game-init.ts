// ─────────────────────────── Game initialization (worker re-export) ─
//
// Initial-state construction moved to `@eoe/rules` in #57 — the rules
// package owns the determinism contract. This file is a thin re-export
// so existing worker imports (`./game-init.js`) keep working without
// requiring every route handler to depend on `@eoe/rules` directly.

export {
    addJoiner,
    buildCreatorState,
    CAPITAL_DEFAULT_HP,
    MIN_DECK_AFTER_DRAW,
    STARTING_HAND_SIZE,
} from '@eoe/rules';
