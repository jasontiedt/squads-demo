import { z } from 'zod';
import { Civ } from './civ.js';
import { ResourceKind } from './resources.js';

// ─────────────────────────────── Cards ───────────────────────────────
//
// Per `wedge-rulebook-synthesis.md` and the rulebook (`Rulebook_EN.txt`),
// cards fall into one of eight kinds. Buildings (Camp/Barracks/Capital)
// are NOT cards — they are tokens placed during Mobilization, modeled
// elsewhere.
//
// Card kinds (all in this discriminated union):
//   • unit          — deployable combat piece with movement + combat stats
//   • technology    — Deployment-phase only, 4 sub-types (rulebook §"Technology and Tactic")
//   • tactic        — playable in Mobilization OR Deployment, discarded after use
//   • upgrade       — attaches to a deployed unit; class-restricted unless any-unit
//   • action        — one-shot effect, discarded after use
//   • reaction      — played on opponent's turn (schema-only stub for MVP-1)
//   • event         — persistent global effect, ≤3 active per player
//   • civilization  — one per player, sits on Unit Field, NEVER in deck
//
// `effect` and `trigger` payloads are intentionally loose (`z.unknown()`)
// for MVP-1: the shape is TBD until card handlers are designed in
// `@eoe/rules`. Choosing `z.unknown()` over `z.string()` keeps the door
// open for structured DSLs without forcing prose-only effects today.
// See `.squad/decisions/inbox/artoo-card-effect-typing.md`.

/** Branded id for a card definition (the catalog id, not an instance id). */
export const CardId = z.string().min(1).brand<'CardId'>();
export type CardId = z.infer<typeof CardId>;

/**
 * Resource cost for a card. Each entry is a count of tokens that must be
 * exhausted to play the card. Costs without an entry default to zero.
 *
 * @needs-confirmation: The rulebook also describes a "flexible resource
 *   cost" (greyed-out symbol) that the player may pay with any kind. That
 *   is not modeled here yet — represent it via `wild` for MVP-1 and
 *   refine if/when card data needs a separate field.
 */
export const CardCost = z.record(ResourceKind, z.number().int().nonnegative());
export type CardCost = z.infer<typeof CardCost>;

/** Common fields shared by every card kind. `kind` lives on each member. */
const CardCommon = {
  id: CardId,
  name: z.string().min(1),
  civ: Civ.optional(),
  flavor: z.string().optional(),
  imageRef: z.string().min(1).optional(),
} as const;

// ─────────────────────────────── Unit ────────────────────────────────

/**
 * Movement profile for a unit card.
 *
 * - `points` — squares the unit may traverse per move action.
 * - `pattern` — optional shape modifier. The rulebook distinguishes
 *   short-range vs long-range movement on some unit types (e.g. Naval).
 *   Cards without an explicit pattern omit the field.
 */
export const UnitMovement = z.object({
  points: z.number().int().nonnegative(),
  pattern: z.enum(['short', 'long']).optional(),
});
export type UnitMovement = z.infer<typeof UnitMovement>;

export const UnitCard = z.object({
  ...CardCommon,
  kind: z.literal('unit'),
  cost: CardCost,
  movement: UnitMovement,
  melee: z.number().int().nonnegative(),
  ranged: z.number().int().nonnegative(),
  health: z.number().int().positive(),
  class: z.array(z.string().min(1)),
  keywords: z.array(z.string().min(1)),
});
export type UnitCard = z.infer<typeof UnitCard>;

// ──────────────────────────── Technology ─────────────────────────────

/**
 * Technology subtype. The rulebook says "There are 4 different technology
 * types" but does not name them in the extracted text.
 *
 * @needs-confirmation: subtype names. Issue #3 specifies `'A'|'B'|'C'|'D'`
 *   as placeholders. Replace with rulebook-canonical names once a civ
 *   booklet (Byzantines/English) enumerates them.
 */
export const TechnologySubType = z.enum(['A', 'B', 'C', 'D']);
export type TechnologySubType = z.infer<typeof TechnologySubType>;

export const TechnologyCard = z.object({
  ...CardCommon,
  kind: z.literal('technology'),
  cost: CardCost,
  subType: TechnologySubType,
  /** Loose for MVP-1 — see file header. */
  effect: z.unknown(),
});
export type TechnologyCard = z.infer<typeof TechnologyCard>;

// ─────────────────────────────── Tactic ──────────────────────────────

export const TacticPhase = z.enum(['mobilization', 'deployment']);
export type TacticPhase = z.infer<typeof TacticPhase>;

export const TacticCard = z.object({
  ...CardCommon,
  kind: z.literal('tactic'),
  cost: CardCost,
  /** Phases the tactic may be played in (≥1, deduplicated by Zod consumers). */
  playableIn: z.array(TacticPhase).min(1),
  effect: z.unknown(),
});
export type TacticCard = z.infer<typeof TacticCard>;

// ─────────────────────────────── Upgrade ─────────────────────────────

export const UpgradeCard = z.object({
  ...CardCommon,
  kind: z.literal('upgrade'),
  cost: CardCost,
  /** Omitted when the upgrade can attach to any unit class. */
  restrictedToClass: z.array(z.string().min(1)).optional(),
  effect: z.unknown(),
});
export type UpgradeCard = z.infer<typeof UpgradeCard>;

// ─────────────────────────────── Action ──────────────────────────────

export const ActionCard = z.object({
  ...CardCommon,
  kind: z.literal('action'),
  cost: CardCost,
  effect: z.unknown(),
});
export type ActionCard = z.infer<typeof ActionCard>;

// ────────────────────────────── Reaction ─────────────────────────────
//
// Schema-only stub for MVP-1. Rules engine does NOT resolve reactions
// yet; the shape exists so that catalog ingestion does not have to be
// reworked when reactions are turned on. See rulebook §"Reaction" and
// the open questions in `wedge-rulebook-synthesis.md`.

export const ReactionCard = z.object({
  ...CardCommon,
  kind: z.literal('reaction'),
  cost: CardCost,
  /** Loose for MVP-1 — trigger taxonomy TBD. */
  trigger: z.unknown(),
  effect: z.unknown(),
});
export type ReactionCard = z.infer<typeof ReactionCard>;

// ─────────────────────────────── Event ───────────────────────────────

export const EventCard = z.object({
  ...CardCommon,
  kind: z.literal('event'),
  cost: CardCost,
  /** Pinned to `true` — Events are persistent by definition (rulebook §"Event"). */
  persistent: z.literal(true),
  effect: z.unknown(),
});
export type EventCard = z.infer<typeof EventCard>;

// ──────────────────────────── Civilization ───────────────────────────
//
// Civilization cards never sit in the deck — they live on the Unit Field
// from setup. They carry the civ identity used to gate civ-specific
// effects.

export const CivilizationCard = z.object({
  ...CardCommon,
  kind: z.literal('civilization'),
  civId: Civ,
  effect: z.unknown(),
});
export type CivilizationCard = z.infer<typeof CivilizationCard>;

// ───────────────────────── Discriminated Union ───────────────────────

/**
 * The Card discriminated union. Adding a new kind requires:
 *   1. Define the per-kind schema with `kind: z.literal('...')`.
 *   2. Append it to this union.
 *   3. Add happy + reject tests in `__tests__/cards.test.ts`.
 *   4. Update the exhaustiveness test (`CARD_KINDS`) below.
 */
export const Card = z.discriminatedUnion('kind', [
  UnitCard,
  TechnologyCard,
  TacticCard,
  UpgradeCard,
  ActionCard,
  ReactionCard,
  EventCard,
  CivilizationCard,
]);
export type Card = z.infer<typeof Card>;

/** The literal set of card kinds in this union. Kept in sync with `Card`. */
export const CARD_KINDS = [
  'unit',
  'technology',
  'tactic',
  'upgrade',
  'action',
  'reaction',
  'event',
  'civilization',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];
