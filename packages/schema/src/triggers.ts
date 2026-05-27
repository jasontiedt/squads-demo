import { z } from 'zod';

// ─────────────────────────── Reaction triggers ───────────────────────
//
// MVP-6 S5 (#101). The trigger taxonomy is CLOSED at 5 — mirrors the
// `Effect` DSL approach (#83). Discriminator: `kind`.
//
//   • `on-attack-declared`  — fires when an Attack action is declared.
//   • `on-damage-dealt`     — fires when damage lands on a unit or
//                             capital. Optional `minDamage` lets a
//                             reaction gate on amount.
//   • `on-unit-destroyed`   — fires when a unit drops to 0 HP and
//                             leaves the board. Optional `unitClass`
//                             filter narrows to a class.
//   • `on-card-played`      — fires after a card is successfully
//                             played. Optional `cardKindFilter`
//                             narrows to a specific card kind.
//   • `on-phase-end`        — fires at the end of a specific phase.
//
// The Effect a Reaction dispatches is one of the existing 7 `Effect`
// verbs (no new verb is introduced for reactions — locked by Wedge in
// `wedge-mvp6-scope.md` §4 L5).
//
// Adding a new trigger kind is a schema-major change. Do not extend
// this union without coordinating with Wedge.
//
// ─── Re-declarations (cycle avoidance) ───
//
// `cards.ts` will import `ReactionTrigger` (for `ReactionCard.trigger`)
// and `state.ts` will import it (for `pendingReactionWindow`). To avoid
// a triggers ↔ cards ↔ state cycle, the two primitives we need are
// re-declared here. Structural equivalence is enforced by the schemas
// in `./cards.ts` (`CARD_KINDS`) and `./state.ts` (`TurnPhase`); if they
// drift, consumers importing the canonical versions surface a TS error.

const TurnPhaseLocal = z.enum(['start', 'mobilization', 'deployment', 'end', 'ended']);

const CardKindLocal = z.enum([
  'unit',
  'technology',
  'tactic',
  'upgrade',
  'action',
  'reaction',
  'event',
  'civilization',
]);

export const OnAttackDeclaredTrigger = z
  .object({
    kind: z.literal('on-attack-declared'),
  })
  .strict();
export type OnAttackDeclaredTrigger = z.infer<typeof OnAttackDeclaredTrigger>;

export const OnDamageDealtTrigger = z
  .object({
    kind: z.literal('on-damage-dealt'),
    /**
     * Optional. If set, the reaction matches only when the damage
     * dealt is >= `minDamage`. Eligibility check reads the trigger
     * context's `amount` field on the open window.
     */
    minDamage: z.number().int().positive().optional(),
  })
  .strict();
export type OnDamageDealtTrigger = z.infer<typeof OnDamageDealtTrigger>;

export const OnUnitDestroyedTrigger = z
  .object({
    kind: z.literal('on-unit-destroyed'),
    /**
     * Optional class filter (e.g. 'cavalry'). When set, eligibility
     * narrows to destroyed units whose catalog `class` includes this
     * value.
     */
    unitClass: z.string().min(1).optional(),
  })
  .strict();
export type OnUnitDestroyedTrigger = z.infer<typeof OnUnitDestroyedTrigger>;

export const OnCardPlayedTrigger = z
  .object({
    kind: z.literal('on-card-played'),
    /**
     * Optional `CardKind` filter (e.g. 'action'). When set,
     * eligibility narrows to plays of that card kind only.
     */
    cardKindFilter: CardKindLocal.optional(),
  })
  .strict();
export type OnCardPlayedTrigger = z.infer<typeof OnCardPlayedTrigger>;

export const OnPhaseEndTrigger = z
  .object({
    kind: z.literal('on-phase-end'),
    /** Specific phase the trigger fires at the end of. */
    phase: TurnPhaseLocal,
  })
  .strict();
export type OnPhaseEndTrigger = z.infer<typeof OnPhaseEndTrigger>;

/** Closed 5-trigger taxonomy. See file header. */
export const ReactionTrigger = z.discriminatedUnion('kind', [
  OnAttackDeclaredTrigger,
  OnDamageDealtTrigger,
  OnUnitDestroyedTrigger,
  OnCardPlayedTrigger,
  OnPhaseEndTrigger,
]);
export type ReactionTrigger = z.infer<typeof ReactionTrigger>;

/** Tuple of every legal `ReactionTrigger['kind']`. Used for exhaustiveness checks. */
export const REACTION_TRIGGER_KINDS = [
  'on-attack-declared',
  'on-damage-dealt',
  'on-unit-destroyed',
  'on-card-played',
  'on-phase-end',
] as const;
export type ReactionTriggerKind = (typeof REACTION_TRIGGER_KINDS)[number];

// ─────────────────────────── Trigger context ─────────────────────────
//
// The serializable summary attached to an open reaction window. Carries
// the metadata needed for the UI to render the window and for future
// eligibility refinements (e.g. `on-damage-dealt` with `minDamage` may
// compare `triggerContext.amount`).
//
// MVP-6 S5 keeps the context loose: a record of string → unknown. The
// rules engine reads only the discriminator `kind` on the trigger
// (which lives on the WINDOW, not the context) — context fields are
// reserved for client UX rendering and a future S5+ refinement of
// eligibility checks.
//
// Locked at this shape for S5. A typed discriminated union of context
// shapes (one per trigger kind) is fair game in a follow-up if real
// cards need stricter checks.
export const TriggerContext = z.record(z.string(), z.unknown());
export type TriggerContext = z.infer<typeof TriggerContext>;
