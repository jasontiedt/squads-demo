// ─────────────────────────── Result & RuleError ─────────────────────
//
// Issue #6: the rules engine speaks in a discriminated `Result<T>` union
// — never throws for control flow. `applyAction` and every internal
// handler return either `{ ok: true, value }` or `{ ok: false, error }`.
//
// `RuleError.code` is a string-literal enum we extend as the engine
// grows. Keep codes machine-stable (`snake_case`, no punctuation) — UI
// and tests both pattern-match on them. `message` is human-readable
// and may include identifiers from the action (unit id, phase name,
// etc.) for debugging.
//
// Living taxonomy:
//
//   'not_implemented'  — action passed the gate but its effect handler
//                        is a stub. Lifted as each effect lands (#7+).
//   'wrong_phase'      — action illegal in the current `state.phase`.
//   'not_your_turn'    — active-turn action attempted by a non-active
//                        seat (or reaction attempted by the active seat).
//   'unknown_action'   — discriminator did not match a known variant.
//                        Should be unreachable for parsed `Action`
//                        inputs; defensive only.
//
// DeployUnit (#8) added the following effect-handler codes:
//
//   'card_not_in_hand'     — actor's hand does not contain the cardId.
//   'card_not_in_catalog'  — civ catalog (`@eoe/assets-meta`) lookup
//                            for the cardId returned nothing. Indicates
//                            either fixture drift or a malformed action.
//   'card_not_unit'        — cardId resolved to a non-unit card kind
//                            (technology / tactic / action / etc.).
//   'invalid_deploy_square' — MVP Capital-only deploy: `action.square`
//                            is not equal to the player's `capitalSquare`.
//                            Will be loosened once Barracks/zone deploys
//                            (#TBD) land.
//   'insufficient_resources' — not enough unexhausted tokens of the
//                            required kind(s) to satisfy the card cost.
//
// Don't reuse codes across error classes — distinct codes are cheaper
// to triage than overloaded ones.

export type RuleErrorCode =
  | 'not_implemented'
  | 'wrong_phase'
  | 'not_your_turn'
  | 'unknown_action'
  | 'card_not_in_hand'
  | 'card_not_in_catalog'
  | 'card_not_unit'
  | 'invalid_deploy_square'
  | 'insufficient_resources'
  // Scout (#56) — Scout targets a face-down tile via a square coord.
  // `tile_not_found` covers both "no tile at this coord" and the
  // defensive "tile vanished" branch. `tile_already_revealed` is the
  // distinct "tile exists but faceDown is false" case.
  | 'tile_not_found'
  | 'tile_already_revealed'
  // Attack (#54) — MVP-3 attacker/target validation. `attacker_*` codes
  // pin issues with the attacker side; `target_*` and `out_of_range`
  // pin defender / geometry issues. `attack_mode_mismatch` catches a
  // caller bug where the action mode disagrees with the attacker's
  // current `attackMode`. `attack_value_zero` rejects e.g. a melee-
  // only unit asked to attack in ranged mode.
  | 'attacker_not_found'
  | 'attacker_not_yours'
  | 'attacker_exhausted'
  | 'target_not_found'
  | 'target_friendly'
  | 'out_of_range'
  | 'attack_mode_mismatch'
  | 'attack_value_zero';

export interface RuleError {
  readonly code: RuleErrorCode;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RuleError };

/** Tiny constructor helpers — keep call sites uncluttered. */
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const err = (code: RuleErrorCode, message: string): Result<never> => ({
  ok: false,
  error: { code, message },
});
