import type { ClassWidePassiveRegistration, Effect, GameState } from '@eoe/schema';

import { ok, type Result } from '../result.js';
import type { EffectContext } from './dispatch.js';

// ─────────────────────────── class-wide-passive (Issue #98) ──────────
//
// Technology-card effect: register a persistent stat or keyword
// modifier that applies to every unit matching a class filter +
// ownership. The schema constrains `modifier` to one of two shapes:
//   • { kind: 'stat-delta', stat, delta }
//   • { kind: 'keyword', keyword }
//
// Pure apply: push a `ClassWidePassiveRegistration` onto
// `state.classWidePassives`. The registration records the actor seat
// so the future `effectiveStats` helper (S3) can resolve 'own' /
// 'opponent' / 'all' at read time.
//
// Permanent for MVP-6 per the technology scope lock — no removal verb
// in this slice. Lifecycle (technology dispel, replacement) is S3+.
//
// Determinism: no RNG, no clock, no I/O. Append-only mutation.

/**
 * Apply a `class-wide-passive` effect. Always succeeds — schema
 * validation has already accepted the payload, and no state precondition
 * exists (registry is append-only).
 *
 * Note: this does NOT validate that `classFilter` matches any real
 * catalog class. An orphan registration is harmless (the read-time
 * filter just selects zero units) and validating against the catalog
 * here would couple this pure function to `loadCivMeta`, breaking the
 * "no I/O" guarantee for the slice. Card-design hygiene is a catalog
 * concern.
 */
export function applyClassWidePassive(
  state: GameState,
  effect: Extract<Effect, { kind: 'class-wide-passive' }>,
  ctx: EffectContext,
): Result<GameState> {
  const registration: ClassWidePassiveRegistration = {
    seat: ctx.actorSeat,
    classFilter: effect.classFilter,
    ownership: effect.ownership,
    modifier: effect.modifier,
    // sourceTechId is not threaded through the EffectContext today;
    // when PlayTechnology lands and can pass the catalog card id, this
    // becomes populated.
  };

  const existing = state.classWidePassives ?? [];
  return ok({
    ...state,
    classWidePassives: [...existing, registration],
  });
}
