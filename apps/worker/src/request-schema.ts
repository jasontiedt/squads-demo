// ─────────────────────────── Request bodies ─────────────────────────
//
// Zod schemas for inbound request payloads. Request shape is validated
// at the edge before any KV reads — invalid bodies become structured
// 400s instead of opaque crashes.

import { z } from 'zod';
import { Action, Civ, ResourceToken, Seat, UnitInstance } from '@eoe/schema';

/** POST /games — creator picks display name + civ. */
export const CreateGameBody = z
  .object({
    playerName: z.string().min(1).max(40),
    civ: Civ,
  })
  .strict();
export type CreateGameBody = z.infer<typeof CreateGameBody>;

/** POST /games/:code/join — joiner picks display name + civ. */
export const JoinGameBody = z
  .object({
    playerName: z.string().min(1).max(40),
    civ: Civ,
  })
  .strict();
export type JoinGameBody = z.infer<typeof JoinGameBody>;

/**
 * POST /games/:code/actions — submit an action under optimistic
 * versioning. Caller must include the seat they claim to be acting as,
 * the playerToken issued at create/join (we verify sha256(token)
 * against `tokenHashes[seat]`), and the `expectedVersion` they last
 * saw on the state. Mismatch → 409.
 */
export const PostActionBody = z
  .object({
    seat: Seat,
    token: z.string().min(1),
    expectedVersion: z.number().int().nonnegative(),
    action: Action,
  })
  .strict();
export type PostActionBody = z.infer<typeof PostActionBody>;

/**
 * POST /admin/games/:code/seed — admin-only deterministic seed of seat
 * A + B decks and opening hands. Used by Playwright e2e to pin
 * card-draw RNG out of the test flow. Gated by `X-Admin-Secret` in the
 * route; invariant enforced there is that the game has not yet had any
 * action applied (state.moveLog must be empty).
 */
export const ResourceTokenSeed = ResourceToken;
export type ResourceTokenSeed = z.infer<typeof ResourceTokenSeed>;

export const UnitInstanceSeed = UnitInstance.omit({ owner: true });
export type UnitInstanceSeed = z.infer<typeof UnitInstanceSeed>;

const AdminSeedSeatResources = z
  .object({
    seat1: z.array(ResourceTokenSeed).optional(),
    seat2: z.array(ResourceTokenSeed).optional(),
  })
  .strict();

const AdminSeedSeatUnits = z
  .object({
    seat1: z.array(UnitInstanceSeed).optional(),
    seat2: z.array(UnitInstanceSeed).optional(),
  })
  .strict();

export const AdminSeedBody = z
  .object({
    deckOrder: z.array(z.string().min(1)),
    opponentDeckOrder: z.array(z.string().min(1)),
    hand: z.array(z.string().min(1)),
    opponentHand: z.array(z.string().min(1)),
    resources: AdminSeedSeatResources.optional(),
    units: AdminSeedSeatUnits.optional(),
  })
  .strict();
export type AdminSeedBody = z.infer<typeof AdminSeedBody>;
