import { loadCivMeta } from '@eoe/assets-meta';
import type {
  Action,
  GameState,
  Seat,
  UnitInstance,
} from '@eoe/schema';

import { err, ok, type Result } from './result.js';

// ─────────────────────────── attack (Issue #54) ──────────────────────
//
// MVP-3 #2 — pure Attack handler: one unit attacks another, defender
// takes damage equal to attacker's attack value, dead defenders are
// removed from `state.units[]`.
//
// Phase + seat gating runs upstream in `applyAction` (Attack is only
// legal during `mobilization`, by the active seat — see `phases.ts`).
// This handler only runs once those checks pass.
//
// Schema reminder: `AttackAction = { type: 'Attack', attackerUnitId,
// targetUnitId? | targetBuildingId? (XOR), mode: 'melee' | 'ranged' }`.
//
// Preconditions verified here:
//   1. Action targets a UNIT, not a building (building attacks =
//      Capital damage, MVP-4 — rejected with `not_implemented`).
//   2. Attacker exists in `state.units[]` and is owned by `actorId`.
//   3. Attacker is NOT exhausted (one action per unit per turn — see
//      decision file `artoo-attack-acted-tracking.md`).
//   4. Target exists in `state.units[]` and is owned by a different
//      seat (no friendly fire).
//   5. `action.mode` matches `attacker.attackMode` (caller must be
//      explicit about which mode the attacker is currently in).
//   6. Attacker's catalog card has a non-zero stat for that mode
//      (a melee-only unit cannot attack in ranged mode).
//   7. Target is within range for the attacker's mode:
//        - melee  → Chebyshev distance == 1 (adjacent incl. diagonals)
//        - ranged → Chebyshev distance >= 2 (no max range for MVP-3,
//                   flagged `@needs-confirmation`)
//
// Effects (on success):
//   • Defender accumulates damage by `attackerCard[mode]`. If
//     `defender.damage >= defenderCard.health` → defender removed from
//     `state.units[]`. Otherwise defender's `damage` is bumped in place.
//   • Attacker's `exhausted` flag is flipped to `true` (one-action-per-
//     turn — see decision file).
//
// Determinism: no RNG, no clock, no I/O. Input `state` is not mutated;
// we splice a new `units` array.
//
// Version: the rules engine NEVER bumps `state.version` — that lives in
// the Worker (matches `playCard.ts`, `scout.ts`, `deployUnit.ts` —
// wedge-multiplayer-architecture.md is the source of truth).
//
// MVP-3 simplifications (each `@needs-confirmation` in tests):
//   - Ranged has no max range cap. Real rules likely cap at 2-3 squares.
//   - No line-of-sight / blocking-terrain check.
//   - No keyword effects (Charge, Armor, Long-Range bonuses).
//   - No counter-attack from defender.
//   - No retaliation by adjacent friendly units.

type AttackAction = Extract<Action, { type: 'Attack' }>;

export function attack(
  state: GameState,
  action: AttackAction,
  actorId: Seat,
): Result<GameState> {
  // Defensive — upstream gate should always catch this, but
  // `state.players[seat]` is `Player | undefined` under
  // `noUncheckedIndexedAccess`.
  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  // 1) Capital / building target — MVP-4 concern. Action shape allows
  //    `targetBuildingId` via XOR refine, but the effect path is not
  //    lifted yet.
  if (action.targetBuildingId !== undefined) {
    return err(
      'not_implemented',
      'Attack against a building (capital damage) is MVP-4; not yet implemented',
    );
  }
  if (action.targetUnitId === undefined) {
    // Should be unreachable for Zod-parsed actions (the union refine
    // enforces XOR), but the phase-gate test suite stubs minimal Attack
    // shapes that bypass parsing. Treat as not_found rather than throw.
    return err(
      'target_not_found',
      'Attack action is missing a target',
    );
  }

  // 2) Locate the attacker. Search `state.units[]` by id.
  const attackerIdx = state.units.findIndex(
    (u) => u.id === action.attackerUnitId,
  );
  if (attackerIdx < 0) {
    return err(
      'attacker_not_found',
      `attacker unit ${action.attackerUnitId} is not on the board`,
    );
  }
  const attacker = state.units[attackerIdx];
  if (attacker === undefined) {
    // Unreachable given findIndex, but strict-mode indexed-access
    // forces us to re-read.
    return err(
      'attacker_not_found',
      `attacker at index ${attackerIdx} disappeared (defensive)`,
    );
  }

  // 3) Attacker ownership.
  if (attacker.owner !== actorId) {
    return err(
      'attacker_not_yours',
      `attacker unit ${action.attackerUnitId} is owned by seat ${attacker.owner}, not actor seat ${actorId}`,
    );
  }

  // 4) Attacker must not already have acted this turn (exhausted = the
  //    rulebook's "tapped" state — see artoo-attack-acted-tracking.md).
  if (attacker.exhausted) {
    return err(
      'attacker_exhausted',
      `attacker unit ${action.attackerUnitId} has already acted this turn`,
    );
  }

  // 5) Action mode must match attacker's current attack mode. Forces
  //    callers (UI / Worker re-validation) to be explicit about the
  //    mode the attacker is currently in, rather than silently using
  //    the unit's current mode.
  if (action.mode !== attacker.attackMode) {
    return err(
      'attack_mode_mismatch',
      `Attack mode '${action.mode}' does not match attacker's current mode '${attacker.attackMode}'`,
    );
  }

  // 6) Self-attack guard (cheap; catches a class of caller bugs before
  //    the friendly-fire check needs to fire).
  if (action.targetUnitId === action.attackerUnitId) {
    return err(
      'target_friendly',
      'A unit cannot attack itself',
    );
  }

  // 7) Locate the defender.
  const defenderIdx = state.units.findIndex(
    (u) => u.id === action.targetUnitId,
  );
  if (defenderIdx < 0) {
    return err(
      'target_not_found',
      `target unit ${action.targetUnitId} is not on the board`,
    );
  }
  const defender = state.units[defenderIdx];
  if (defender === undefined) {
    return err(
      'target_not_found',
      `target at index ${defenderIdx} disappeared (defensive)`,
    );
  }

  // 8) Friendly-fire guard.
  if (defender.owner === actorId) {
    return err(
      'target_friendly',
      `target unit ${action.targetUnitId} is owned by the actor (seat ${actorId}); friendly fire is not allowed`,
    );
  }

  // 9) Range check. Chebyshev distance: max(|Δx|, |Δy|).
  const dx = Math.abs(attacker.square.x - defender.square.x);
  const dy = Math.abs(attacker.square.y - defender.square.y);
  const cheb = dx > dy ? dx : dy;
  if (action.mode === 'melee') {
    if (cheb !== 1) {
      return err(
        'out_of_range',
        `melee attack requires adjacency (Chebyshev distance == 1); got ${cheb}`,
      );
    }
  } else {
    // ranged
    // @needs-confirmation: ranged has no upper bound for MVP-3. Real
    // rules likely cap at 2-3 squares (see card keywords like
    // "Long-Range"). Pinned with a skipped test in attack.test.ts.
    if (cheb < 2) {
      return err(
        'out_of_range',
        `ranged attack requires non-adjacent target (Chebyshev distance >= 2); got ${cheb}`,
      );
    }
  }

  // 10) Look up the attacker's card to read the attack value for the
  //     current mode. Determinism: `loadCivMeta` is a compile-time JSON
  //     import — no runtime I/O.
  const attackerCatalog = loadCivMeta(player.civ);
  const attackerCard = attackerCatalog.find((c) => c.id === attacker.cardId);
  if (attackerCard === undefined || attackerCard.kind !== 'unit') {
    return err(
      'card_not_in_catalog',
      `attacker's card ${attacker.cardId} not found in catalog for civ ${player.civ}, or is not a unit card`,
    );
  }
  const attackValue =
    action.mode === 'melee' ? attackerCard.melee : attackerCard.ranged;
  if (attackValue <= 0) {
    return err(
      'attack_value_zero',
      `attacker's card ${attacker.cardId} has 0 ${action.mode} attack and cannot attack in that mode`,
    );
  }

  // 11) Look up defender's card for health.
  const defenderOwnerPlayer = state.players[defender.owner];
  if (defenderOwnerPlayer === undefined) {
    return err(
      'target_not_found',
      `defender unit ${action.targetUnitId} owner seat ${defender.owner} has no player record`,
    );
  }
  const defenderCatalog = loadCivMeta(defenderOwnerPlayer.civ);
  const defenderCard = defenderCatalog.find((c) => c.id === defender.cardId);
  if (defenderCard === undefined || defenderCard.kind !== 'unit') {
    return err(
      'card_not_in_catalog',
      `defender's card ${defender.cardId} not found in catalog for civ ${defenderOwnerPlayer.civ}, or is not a unit card`,
    );
  }

  // 12) Apply damage. If accumulated damage >= card.health → remove.
  //     Otherwise bump damage on the defender in place (new instance,
  //     same id).
  const newDamage = defender.damage + attackValue;
  const defenderDies = newDamage >= defenderCard.health;

  const exhaustedAttacker: UnitInstance = { ...attacker, exhausted: true };

  let newUnits: UnitInstance[];
  if (defenderDies) {
    // Remove defender; replace attacker in its slot.
    newUnits = state.units
      .map((u, i) => (i === attackerIdx ? exhaustedAttacker : u))
      .filter((_, i) => i !== defenderIdx);
  } else {
    const damagedDefender: UnitInstance = { ...defender, damage: newDamage };
    newUnits = state.units.map((u, i) => {
      if (i === attackerIdx) return exhaustedAttacker;
      if (i === defenderIdx) return damagedDefender;
      return u;
    });
  }

  return ok({
    ...state,
    units: newUnits,
  });
}
