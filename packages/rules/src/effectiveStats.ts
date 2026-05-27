import { loadCivMeta } from '@eoe/assets-meta';
import type {
  ClassWidePassiveRegistration,
  GameState,
  UnitCard,
  UnitInstance,
} from '@eoe/schema';

// ─────────────────────────── effectiveStats (Issue #99 — MVP-6 S3) ───
//
// Pure read helper: compute the effective stats of a deployed unit by
// composing the base catalog card on top of every modifier currently
// applied to it. Used by the attack handler (and any future combat /
// UI code) that needs "what does this unit actually hit for right now".
//
// Composition order (additive, base + Σ deltas):
//
//   1. Base stats — `UnitCard.melee | ranged | health` from the unit's
//      catalog entry (looked up via the owning seat's civ catalog).
//   2. Class-wide passives — every `ClassWidePassiveRegistration` in
//      `state.classWidePassives` whose `classFilter` intersects the
//      unit's card class AND whose `ownership` (resolved against the
//      registering seat) covers this unit's owner. Stat-delta
//      modifiers contribute their `delta`; keyword modifiers
//      contribute a keyword string.
//   3. Unit attachments — each `UnitAttachment` contributes its
//      `keyword` to the effective keyword set. Attachments do NOT
//      contribute stat deltas (the schema only carries keyword
//      strings; stat-changing upgrades would surface as buffs).
//   4. Temporary buffs — every `TemporaryBuff` on the unit contributes
//      its `delta`. End-of-turn cleanup (see `applyAction.ts` EndTurn)
//      sweeps these; in between they stack additively.
//
// Movement is not modified by any MVP-6 effect — neither class-wide
// passives nor attachments carry movement deltas in the current schema.
// We return the base card's `movement.points` unchanged so callers can
// treat the result as a single source of truth.
//
// Keyword accumulation includes both the base card's `keywords` array
// and every modifier-supplied keyword. Duplicates are preserved —
// dedup is a card-rules concern and there are real cases (e.g. two
// pierce stacking into pierce-2) where the caller wants the count.
//
// Determinism: no RNG, no clock, no I/O. `loadCivMeta` is a compile-
// time JSON import. The returned object is freshly allocated; the
// caller owns it.
//
// ⚠️ NOTE FOR FUTURE WORK: existing `attack.ts` still reads base card
// stats directly. Wiring it through `effectiveStats` is deliberately
// deferred to a follow-up issue (S3 is the foundation slice — the
// refactor is non-trivial and bundles its own test sweep). Once that
// lands, combat will respect class-wide passives and unit upgrades
// for free.

export interface EffectiveStats {
  readonly melee: number;
  readonly ranged: number;
  readonly health: number;
  readonly movement: number;
  readonly keywords: readonly string[];
}

/**
 * Compute the effective stats of a deployed unit. Returns `undefined`
 * if the unit's catalog card cannot be resolved (state drift — should
 * not happen for valid GameStates) so callers can decide whether to
 * treat that as a hard error or fall back.
 */
export function effectiveStats(
  unit: UnitInstance,
  state: GameState,
): EffectiveStats | undefined {
  const player = state.players[unit.owner];
  if (player === undefined) return undefined;

  const catalog = loadCivMeta(player.civ);
  const card = catalog.find((c) => c.id === unit.cardId);
  if (card === undefined || card.kind !== 'unit') return undefined;

  // Narrowed to UnitCard by the `kind === 'unit'` check above.
  const unitCard: UnitCard = card;

  let melee = unitCard.melee;
  let ranged = unitCard.ranged;
  let health = unitCard.health;
  const keywords: string[] = [...unitCard.keywords];

  // ─── Class-wide passives ───
  // Walk the registry; each entry that applies to this unit contributes
  // either a stat delta or a keyword to the accumulator.
  const passives = state.classWidePassives ?? [];
  for (const reg of passives) {
    if (!appliesTo(reg, unit, unitCard)) continue;
    if (reg.modifier.kind === 'stat-delta') {
      if (reg.modifier.stat === 'melee') melee += reg.modifier.delta;
      else if (reg.modifier.stat === 'ranged') ranged += reg.modifier.delta;
      else health += reg.modifier.delta;
    } else {
      // keyword modifier
      keywords.push(reg.modifier.keyword);
    }
  }

  // ─── Unit attachments (Upgrade keywords) ───
  const attachments = unit.attachments ?? [];
  for (const att of attachments) {
    keywords.push(att.keyword);
  }

  // ─── Temporary buffs ───
  const buffs = unit.temporaryBuffs ?? [];
  for (const b of buffs) {
    if (b.stat === 'melee') melee += b.delta;
    else if (b.stat === 'ranged') ranged += b.delta;
    else health += b.delta;
  }

  return {
    melee,
    ranged,
    health,
    movement: unitCard.movement.points,
    keywords,
  };
}

/**
 * Does a class-wide-passive registration apply to a given unit?
 *
 *   • `classFilter` must appear in the unit card's `class` array
 *     (case-sensitive exact match — matches the buff-unit-stat
 *     selector convention in `effects/dispatch.ts`).
 *   • `ownership` resolves against the REGISTERING seat:
 *       'own'      → reg.seat === unit.owner
 *       'opponent' → reg.seat !== unit.owner
 *       'all'      → always true
 */
function appliesTo(
  reg: ClassWidePassiveRegistration,
  unit: UnitInstance,
  unitCard: UnitCard,
): boolean {
  if (!unitCard.class.includes(reg.classFilter)) return false;
  switch (reg.ownership) {
    case 'own':
      return reg.seat === unit.owner;
    case 'opponent':
      return reg.seat !== unit.owner;
    case 'all':
      return true;
  }
}
