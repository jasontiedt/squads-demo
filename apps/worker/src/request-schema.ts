// ─────────────────────────── Request bodies ─────────────────────────
//
// Zod schemas for inbound request payloads. Request shape is validated
// at the edge before any KV reads — invalid bodies become structured
// 400s instead of opaque crashes.

import { z } from 'zod';
import { Action, Civ, Seat } from '@eoe/schema';

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
