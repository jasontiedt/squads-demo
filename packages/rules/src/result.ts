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
  | 'deck_too_thin'
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
  | 'attack_value_zero'
  // Move (#67) — MVP-4 unit movement. `unit_*` codes pin actor-side
  // issues (ownership, exhaustion). `illegal_move` covers the four
  // blocker conditions called out in the issue spec: water/mountain
  // terrain, occupied destination (friend or enemy), face-down tile,
  // and `action.from` not matching the unit's actual square. The
  // human-readable `message` carries the specific reason.
  | 'unit_not_found'
  | 'unit_not_yours'
  | 'unit_exhausted'
  | 'invalid_build_square'
  | 'illegal_move'
  // PlayAction (#85) — effect-dispatch error path. `not_an_action_card`
  // catches a hand card that isn't `kind: 'action'`. `effect_not_typed`
  // catches an action card whose `effect` payload doesn't parse against
  // the `Effect` discriminated union (still loose `z.unknown()` for
  // catalog cards until #87 migrates them).
  | 'not_an_action_card'
  | 'effect_not_typed'
  // PlayTactic (#86) — same as PlayAction but rejects non-tactic cards.
  // `not_a_tactic` parallels `not_an_action_card`; per-card
  // `playableIn` rejection re-uses the existing `wrong_phase` code.
  | 'not_a_tactic'
  // PlayUpgrade / PlayTechnology (#99, MVP-6 S3) — same family as
  // `not_a_tactic` / `not_an_action_card`. PlayUpgrade additionally
  // gates the target unit:
  //   `target_not_yours`        — target unit exists but is not owned
  //                               by the actor (Upgrades attach to own
  //                               units only at the card-rules layer).
  //   `upgrade_class_mismatch`  — card's `restrictedToClass` set does
  //                               not intersect the target unit's
  //                               class set.
  | 'not_an_upgrade'
  | 'not_a_technology'
  | 'target_not_yours'
  | 'upgrade_class_mismatch'
  // PlayEvent (#100, MVP-6 S4) — `not_an_event_card` parallels
  // `not_an_action_card`. `event_cap_reached` rejects the play when
  // the actor already has 3 active events (rulebook §"Events" hard cap);
  // the engine NEVER auto-discards — caller resolves cap pressure.
  | 'not_an_event_card'
  | 'event_cap_reached'
  // PlayReaction (#101) — MVP-6 S5 opponent reaction window.
  //   `no_window_open`   — no `pendingReactionWindow` is currently set.
  //   `not_eligible_seat` — actor isn't the window's `eligibleSeat`
  //                         (reactions are opponent-windowed).
  //   `trigger_mismatch`  — the reaction card's `trigger.kind` does
  //                         not match the open window's trigger.
  //   `not_a_reaction`    — hand card resolved to a non-reaction card
  //                         kind (parallels `not_an_action_card`).
  | 'no_window_open'
  | 'not_eligible_seat'
  | 'trigger_mismatch'
  | 'not_a_reaction';

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
