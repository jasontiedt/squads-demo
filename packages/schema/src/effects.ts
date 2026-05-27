import { z } from 'zod';
import { ResourceKind } from './resources.js';
import { UnitInstanceId } from './ids.js';

// ────────────────────────────── Effect DSL ───────────────────────────
//
// Locked verb taxonomy for Action and Tactic card effects (issue #83).
// MVP-5 carve-out: Technology, Upgrade, Reaction, and Event cards keep
// `effect: z.unknown()` for now — see `wedge-mvp5-scope.md`.
//
// Adding a new verb is a schema-major change. Do not extend this union
// without coordinating with Wedge.
//
// Discriminator: `kind`.

// ─────────────────────────────── Target ──────────────────────────────
//
// Targets fall into three groups:
//   1. Capital singletons: 'self-capital' | 'opponent-capital'
//   2. A specific deployed unit (by instance id)
//   3. Class-based set selectors (Brady-approved units-by-class)

const SelfCapital = z.literal('self-capital');
const OpponentCapital = z.literal('opponent-capital');

const UnitTarget = z.object({
  kind: z.literal('unit'),
  unitId: UnitInstanceId,
});

const AllOwnUnitsTarget = z.object({
  kind: z.literal('all-own-units'),
  classFilter: z.string().min(1).optional(),
});

const UnitsByClassTarget = z.object({
  kind: z.literal('units-by-class'),
  classFilter: z.string().min(1),
  ownership: z.enum(['own', 'opponent']),
});

export const Target = z.union([
  SelfCapital,
  OpponentCapital,
  UnitTarget,
  AllOwnUnitsTarget,
  UnitsByClassTarget,
]);
export type Target = z.infer<typeof Target>;

// ─────────────────────────── Effect verbs ────────────────────────────

export const DrawEffect = z.object({
  kind: z.literal('draw'),
  count: z.number().int().min(1),
});
export type DrawEffect = z.infer<typeof DrawEffect>;

export const DamageEffect = z.object({
  kind: z.literal('damage'),
  amount: z.number().int().min(1),
  target: Target,
});
export type DamageEffect = z.infer<typeof DamageEffect>;

export const HealCapitalEffect = z.object({
  kind: z.literal('heal-capital'),
  amount: z.number().int().min(1),
  target: z.literal('self'),
});
export type HealCapitalEffect = z.infer<typeof HealCapitalEffect>;

export const GainTemporaryResourceEffect = z.object({
  kind: z.literal('gain-temporary-resource'),
  resource: ResourceKind,
  count: z.number().int().min(1),
  source: z.literal('this-card'),
});
export type GainTemporaryResourceEffect = z.infer<typeof GainTemporaryResourceEffect>;

export const BuffUnitStatEffect = z.object({
  kind: z.literal('buff-unit-stat'),
  target: Target,
  stat: z.enum(['melee', 'ranged', 'health']),
  /** Negative deltas are allowed (debuffs); zero is not meaningful. */
  delta: z.number().int().refine((n) => n !== 0, { message: 'delta must be non-zero' }),
  duration: z.literal('end-of-turn'),
});
export type BuffUnitStatEffect = z.infer<typeof BuffUnitStatEffect>;

// ─────────────────────── MVP-6 S2: DSL extension ─────────────────────
//
// Issue #98 walks the locked 5-verb DSL to 7. The two new verbs cover
// Upgrade and Technology cards — both deferred from MVP-5 — without
// re-opening any other primitive. After this slice the DSL is closed
// again at 7 for the remainder of MVP-6.
//
//   • `attach-keyword`      — Upgrade cards attach a keyword (e.g.
//     'first-strike', 'pierce') to a specific deployed unit. Target
//     is restricted to `{ kind: 'unit' }`; capital and set selectors
//     are not meaningful for unit-level attachments.
//   • `class-wide-passive`  — Technology cards register a persistent
//     stat or keyword modifier that applies to every unit matching a
//     class filter + ownership. No target field — the registration
//     payload IS the selector. The future `effectiveStats` helper (S3)
//     reads from `GameState.classWidePassives` and composes deltas.
//
// Lifecycle (attachment removal on unit death, technology dispel) is
// S3's problem; the schema only describes the shape and the dispatcher
// only performs the apply.

/**
 * Modifier carried by a class-wide-passive registration. A discriminated
 * union so future modifier kinds (e.g. cost reduction) plug in by
 * extending this union, not by re-shaping `class-wide-passive` itself.
 */
const ClassWideStatDelta = z.object({
  kind: z.literal('stat-delta'),
  stat: z.enum(['melee', 'ranged', 'health']),
  delta: z.number().int().refine((n) => n !== 0, { message: 'delta must be non-zero' }),
});
const ClassWideKeyword = z.object({
  kind: z.literal('keyword'),
  keyword: z.string().min(1),
});
export const ClassWidePassiveModifier = z.discriminatedUnion('kind', [
  ClassWideStatDelta,
  ClassWideKeyword,
]);
export type ClassWidePassiveModifier = z.infer<typeof ClassWidePassiveModifier>;

export const AttachKeywordEffect = z.object({
  kind: z.literal('attach-keyword'),
  /** Upgrades attach to one unit; capital/class-set targets rejected. */
  target: z.object({
    kind: z.literal('unit'),
    unitId: UnitInstanceId,
  }),
  keyword: z.string().min(1),
});
export type AttachKeywordEffect = z.infer<typeof AttachKeywordEffect>;

export const ClassWidePassiveEffect = z.object({
  kind: z.literal('class-wide-passive'),
  classFilter: z.string().min(1),
  /**
   * Which units the registration applies to. Resolved at read time
   * against the registering seat (recorded on the state entry):
   *   • 'own'      — units owned by the registering seat
   *   • 'opponent' — units owned by any other seat
   *   • 'all'      — every unit on the board regardless of owner
   */
  ownership: z.enum(['own', 'opponent', 'all']),
  modifier: ClassWidePassiveModifier,
});
export type ClassWidePassiveEffect = z.infer<typeof ClassWidePassiveEffect>;

// ─────────────────────── Discriminated union ─────────────────────────

export const Effect = z.discriminatedUnion('kind', [
  DrawEffect,
  DamageEffect,
  HealCapitalEffect,
  GainTemporaryResourceEffect,
  BuffUnitStatEffect,
  AttachKeywordEffect,
  ClassWidePassiveEffect,
]);
export type Effect = z.infer<typeof Effect>;

/** Locked verb list. Kept in sync with the `Effect` union above. */
export const EFFECT_KINDS = [
  'draw',
  'damage',
  'heal-capital',
  'gain-temporary-resource',
  'buff-unit-stat',
  'attach-keyword',
  'class-wide-passive',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];
