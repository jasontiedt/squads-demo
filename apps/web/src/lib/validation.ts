// Form input validation helpers. Shared between Home (create + join forms)
// and tests. Kept dependency-free — no zod here per the task spec.

import { Civ as CivSchema, Seat as SeatSchema } from '@eoe/schema';
import type { Civ, Seat } from '@eoe/schema';

export const CIV_OPTIONS: readonly Civ[] = CivSchema.options;

/** Game-code rule: 4–6 uppercase alphanumeric chars. */
export const GAME_CODE_PATTERN = /^[A-Z0-9]{4,6}$/;

export const validateGameCode = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return 'Game code is required';
  if (trimmed !== trimmed.toUpperCase())
    return 'Game code must be uppercase';
  if (!GAME_CODE_PATTERN.test(trimmed))
    return 'Game code must be 4–6 letters or digits';
  return null;
};

export const validateName = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return 'Name is required';
  if (trimmed.length > 32) return 'Name must be ≤ 32 characters';
  return null;
};

export const isCiv = (v: string): v is Civ =>
  CivSchema.safeParse(v).success;

export const isSeat = (v: number): v is Seat =>
  SeatSchema.safeParse(v).success;
