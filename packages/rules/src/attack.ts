import { loadCivMeta } from '@eoe/assets-meta';
import type {
  Action,
  GameState,
  Player,
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

  // 1) Capital / building target — MVP-4 path lifted in #78. We branch
  //    early here, run the SAME attacker-side validation as the unit
  //    path (ownership, exhaustion, mode/value), then apply damage to
  //    the matching `Player.capitalHp`. The `BuildingInstance` itself
  //    carries only a `damage` field and lives on indefinitely — even
  //    at `capitalHp <= 0` it is NEVER removed from `state.buildings`.
  //    #68's EndTurn win check reads `Player.capitalHp` and treats
  //    `<= 0` as dead, so we do NOT clamp damage at 0 here.
  //
  //    Non-capital buildings (camp, barracks) remain `not_implemented`
  //    for MVP-5.
  if (action.targetBuildingId !== undefined) {
    return attackBuilding(state, action, actorId, player);
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

// ─────────────────────────── attackBuilding (Issue #78) ──────────────
//
// Capital damage path. Mirrors the unit-target flow's attacker-side
// gates (ownership, exhaustion, mode-match, attack-value > 0) but the
// "defender" is a `BuildingInstance(type='capital')` on `state.buildings`
// and the effect lands on the matching `Player.capitalHp`.
//
// MVP-4 scope (#78):
//   • Capital is the ONLY building kind that takes damage in this
//     handler — camp / barracks stay `not_implemented` until MVP-5.
//   • No self-capital damage (`target_friendly`).
//   • Range check uses the same Chebyshev math as unit-vs-unit.
//   • HP can go NEGATIVE; the win check in #68 reads `capitalHp <= 0`
//     as a dead capital, so we do not clamp.
//   • The capital `BuildingInstance` is NEVER removed from
//     `state.buildings`, even at zero HP — it persists so #68 can
//     declare a winner via EndTurn and so the UI can still render the
//     dead capital's square.
//
// All shared validation with the unit path (attacker existence, owner,
// exhausted, mode match, attack value > 0) is duplicated here rather
// than refactored into a shared helper — keeps this handler readable
// in isolation, matches the inline style of the rest of `attack.ts`.

function attackBuilding(
  state: GameState,
  action: Extract<Action, { type: 'Attack' }>,
  actorId: Seat,
  player: Player,
): Result<GameState> {
  if (action.targetBuildingId === undefined) {
    // Unreachable — caller checks this. Defensive only.
    return err('target_not_found', 'Attack action is missing a building target');
  }

  // 1) Locate the attacker. Same as unit path.
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
    return err(
      'attacker_not_found',
      `attacker at index ${attackerIdx} disappeared (defensive)`,
    );
  }

  // 2) Attacker ownership.
  if (attacker.owner !== actorId) {
    return err(
      'attacker_not_yours',
      `attacker unit ${action.attackerUnitId} is owned by seat ${attacker.owner}, not actor seat ${actorId}`,
    );
  }

  // 3) Attacker not already exhausted.
  if (attacker.exhausted) {
    return err(
      'attacker_exhausted',
      `attacker unit ${action.attackerUnitId} has already acted this turn`,
    );
  }

  // 4) Action mode matches attacker's current attack mode.
  if (action.mode !== attacker.attackMode) {
    return err(
      'attack_mode_mismatch',
      `Attack mode '${action.mode}' does not match attacker's current mode '${attacker.attackMode}'`,
    );
  }

  // 5) Locate the target building.
  const buildingIdx = state.buildings.findIndex(
    (b) => b.id === action.targetBuildingId,
  );
  if (buildingIdx < 0) {
    return err(
      'target_not_found',
      `target building ${action.targetBuildingId} is not on the board`,
    );
  }
  const building = state.buildings[buildingIdx];
  if (building === undefined) {
    return err(
      'target_not_found',
      `target building at index ${buildingIdx} disappeared (defensive)`,
    );
  }

  // 6) Only capitals are damageable for MVP-4. Camp/barracks stay
  //    `not_implemented` until MVP-5.
  if (building.type !== 'capital') {
    return err(
      'not_implemented',
      `Attack against building kind '${building.type}' is not implemented (MVP-4 only lifts capital damage)`,
    );
  }

  // 7) No self-capital damage.
  if (building.owner === actorId) {
    return err(
      'target_friendly',
      `target capital ${action.targetBuildingId} is owned by the actor (seat ${actorId}); friendly fire is not allowed`,
    );
  }

  // 8) Range check vs the capital's square. Same Chebyshev math as
  //    unit-vs-unit.
  const dx = Math.abs(attacker.square.x - building.square.x);
  const dy = Math.abs(attacker.square.y - building.square.y);
  const cheb = dx > dy ? dx : dy;
  if (action.mode === 'melee') {
    if (cheb !== 1) {
      return err(
        'out_of_range',
        `melee attack requires adjacency (Chebyshev distance == 1); got ${cheb}`,
      );
    }
  } else {
    // ranged — same MVP-3 simplification (no upper bound, no LOS).
    if (cheb < 2) {
      return err(
        'out_of_range',
        `ranged attack requires non-adjacent target (Chebyshev distance >= 2); got ${cheb}`,
      );
    }
  }

  // 9) Read the attacker's attack value for the chosen mode.
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

  // 10) Locate the capital's owner Player record. #68's win check reads
  //     `capitalHp` here, not `building.damage`.
  const capitalOwnerPlayer = state.players[building.owner];
  if (capitalOwnerPlayer === undefined) {
    return err(
      'target_not_found',
      `target capital ${action.targetBuildingId} owner seat ${building.owner} has no player record`,
    );
  }

  // 11) Apply effects (immutable):
  //   - Subtract attackValue from owner's capitalHp (no clamp — #68's
  //     EndTurn check is fine with negative).
  //   - Mark attacker as exhausted (same as unit-vs-unit).
  //   - The BuildingInstance itself is NOT mutated — capital persists.
  const exhaustedAttacker: UnitInstance = { ...attacker, exhausted: true };
  const newUnits = state.units.map((u, i) =>
    i === attackerIdx ? exhaustedAttacker : u,
  );
  const newCapitalHp = capitalOwnerPlayer.capitalHp - attackValue;
  const newPlayers = {
    ...state.players,
    [building.owner]: {
      ...capitalOwnerPlayer,
      capitalHp: newCapitalHp,
    },
  };

  return ok({
    ...state,
    units: newUnits,
    players: newPlayers,
  });
}
