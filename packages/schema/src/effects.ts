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

// ─────────────────────── Discriminated union ─────────────────────────

export const Effect = z.discriminatedUnion('kind', [
  DrawEffect,
  DamageEffect,
  HealCapitalEffect,
  GainTemporaryResourceEffect,
  BuffUnitStatEffect,
]);
export type Effect = z.infer<typeof Effect>;

/** Locked verb list. Kept in sync with the `Effect` union above. */
export const EFFECT_KINDS = [
  'draw',
  'damage',
  'heal-capital',
  'gain-temporary-resource',
  'buff-unit-stat',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];
