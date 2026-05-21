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
// Future codes will be added here (e.g. `insufficient_resources`,
// `illegal_target`, `hand_full`). Don't reuse codes across error
// classes — distinct codes are cheaper to triage than overloaded ones.

export type RuleErrorCode =
  | 'not_implemented'
  | 'wrong_phase'
  | 'not_your_turn'
  | 'unknown_action';

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
