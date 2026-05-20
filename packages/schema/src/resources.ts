import { z } from 'zod';

// ──────────────────────────── Resources ──────────────────────────────
//
// Per `wedge-rulebook-synthesis.md`, the rulebook's resource model is
// **per-token, not a count**:
//
//   • Main resources are individual tokens, each with exhausted/unexhausted
//     state and a source Camp (where the token was generated). Camps regenerate
//     their tokens at Start of Turn by unexhausting them.
//   • Temporary resources attach to a specific card (Action or Civ card) and
//     are spent down to zero. Some have a hard `max` capacity.
//   • Player 2's turn-1 Wild is tracked on the player, not as a token, per
//     the issue note — so Wild is still a valid `ResourceKind` (matches Camp
//     terrain Wild) but a starting-wild token will simply have no
//     `sourceCampId`.

/** Branded id for a single resource token. Distinct from raw strings. */
export const ResourceTokenId = z.string().min(1).brand<'ResourceTokenId'>();
export type ResourceTokenId = z.infer<typeof ResourceTokenId>;

/** Branded id for a single temporary-resource pool attached to a card. */
export const TemporaryResourceId = z.string().min(1).brand<'TemporaryResourceId'>();
export type TemporaryResourceId = z.infer<typeof TemporaryResourceId>;

/**
 * Resource kinds. Terrain-derived: each Main token comes from a Camp built on
 * a matching terrain square (forest → wood, farmland → food, mine → stone,
 * gold/gold-double → gold, village → wild).
 *
 * @needs-confirmation: `wedge-rulebook-synthesis.md` enumerated only
 *   {food, wood, gold, wild} for the resource banks, but the issue #2
 *   acceptance criteria explicitly list `stone`. The `mine` terrain in
 *   `TerrainType` strongly implies a stone resource. Pinning to the
 *   five-kind set here; confirm with rulebook before card data is loaded.
 */
export const ResourceKind = z.enum(['wood', 'stone', 'food', 'gold', 'wild']);
export type ResourceKind = z.infer<typeof ResourceKind>;

/**
 * A single Main resource token.
 *
 * - `exhausted` flips false→true when the token is spent during a turn,
 *   and resets back to false at Start of Turn (rulebook).
 * - `sourceCampId` is omitted for tokens not produced by a Camp — e.g. the
 *   starting Wild some civs gain at setup. Per `exactOptionalPropertyTypes`
 *   the field, when present, MUST be a non-empty string.
 */
export const ResourceToken = z.object({
  id: ResourceTokenId,
  kind: ResourceKind,
  exhausted: z.boolean(),
  sourceCampId: z.string().min(1).optional(),
});
export type ResourceToken = z.infer<typeof ResourceToken>;

/**
 * A temporary resource pool attached to a specific card instance.
 *
 * - `current` is the number of charges still available (≥ 0).
 * - `max`, when present, caps `current` (the schema enforces `current ≤ max`).
 *   Cards without a stated cap omit `max` entirely.
 */
export const TemporaryResource = z
  .object({
    id: TemporaryResourceId,
    kind: ResourceKind,
    attachedToCardId: z.string().min(1),
    max: z.number().int().positive().optional(),
    current: z.number().int().nonnegative(),
  })
  .refine((t) => t.max === undefined || t.current <= t.max, {
    message: 'current cannot exceed max',
    path: ['current'],
  });
export type TemporaryResource = z.infer<typeof TemporaryResource>;
