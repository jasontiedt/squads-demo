import type { Effect, GameState, UnitInstance } from '@eoe/schema';

import { err, ok, type Result } from '../result.js';
import type { EffectContext } from './dispatch.js';

// ─────────────────────────── attach-keyword (Issue #98) ──────────────
//
// Upgrade-card effect: attach a single keyword (e.g. 'first-strike',
// 'pierce') to a specific deployed unit. The schema constrains the
// target to `{ kind: 'unit', unitId }` — capital and class-set targets
// don't apply at the unit level.
//
// Pure apply: append an `UnitAttachment` entry to the unit's
// `attachments` array. Lifecycle (removal when the unit dies or the
// Upgrade leaves play) is S3's problem; this slice only writes.
//
// Determinism: no RNG, no clock, no I/O.

/**
 * Apply an `attach-keyword` effect against the game state. Returns a
 * `Result<GameState>`; the caller (dispatcher) handles atomic rollback
 * on error.
 *
 * Errors:
 *   • `target_not_found` — the targeted unit id is not on the board.
 *
 * Note: there is intentionally no friend-only / opponent-only check —
 * Upgrades historically attach to own units only, but the schema-level
 * `target.unitId` does not encode ownership, and an opponent-targeted
 * keyword (e.g. a debuff Upgrade) is not nonsensical. Caller cards can
 * enforce ownership at the catalog layer; the dispatcher does not.
 */
export function applyAttachKeyword(
  state: GameState,
  effect: Extract<Effect, { kind: 'attach-keyword' }>,
  _ctx: EffectContext,
): Result<GameState> {
  const { unitId } = effect.target;
  const target = state.units.find((u) => u.id === unitId);
  if (target === undefined) {
    return err('target_not_found', `unit ${unitId} is not on the board`);
  }

  const newUnits: UnitInstance[] = state.units.map((u) => {
    if (u.id !== unitId) return u;
    const existing = u.attachments ?? [];
    return {
      ...u,
      attachments: [
        ...existing,
        {
          keyword: effect.keyword,
          // Source upgrade tracking is best-effort: the dispatcher
          // doesn't know whether the source card is an Upgrade or some
          // future card kind, so we leave it unset here. A future
          // overload that threads the source card id through the
          // EffectContext can populate it.
        },
      ],
    };
  });

  return ok({ ...state, units: newUnits });
}
