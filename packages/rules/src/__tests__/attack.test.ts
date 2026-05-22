import type {
  Action,
  CardId,
  GameState,
  UnitInstance,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { attack } from '../attack.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

// ─────────────────────────── Attack (Issue #54) ──────────────────────
//
// MVP-3 #2: one unit attacks another, defender takes damage equal to
// attacker's stat (`melee` or `ranged` from the catalog), dead units
// are removed from `state.units[]`, attacker becomes exhausted.
//
// Real catalog cards used (see packages/assets-meta/data/*):
//   - eng-watchman      (melee 1, ranged 0, health 4)
//   - eng-longbowman    (melee 0, ranged 3, health 2)
//   - eng-welsh-infantry (melee 3, ranged 2, health 3)
//   - byz-varangian-guard (melee 4, ranged 0, health 5)
//   - byz-cataphract    (melee 4, ranged 0, health 7)
//
// Attack is legal during `mobilization` phase only (see phases.ts).

const cid = (s: string): CardId => s as CardId;
const uid = (s: string): UnitInstance['id'] => s as UnitInstance['id'];

// ─── Test helpers ────────────────────────────────────────────────────

function makeUnit(
  id: string,
  cardId: string,
  owner: 1 | 2,
  square: { x: number; y: number },
  overrides: Partial<UnitInstance> = {},
): UnitInstance {
  return {
    id: uid(id),
    cardId: cid(cardId),
    owner,
    square,
    exhausted: false,
    damage: 0,
    attackMode: 'melee',
    upgrades: [],
    ...overrides,
  };
}

/**
 * Build an attack-ready state: phase `mobilization`, active seat 1, with
 * a custom list of units on the board.
 */
function attackState(
  units: UnitInstance[],
  patch: Partial<Pick<GameState, 'phase' | 'activePlayer'>> = {},
): GameState {
  return {
    ...baseState,
    phase: 'mobilization',
    activePlayer: SEAT_1,
    units,
    ...patch,
  };
}

interface AttackActionOpts {
  attackerUnitId: string;
  targetUnitId?: string;
  targetBuildingId?: string;
  mode: 'melee' | 'ranged';
}

const attackAction = (opts: AttackActionOpts): Action => {
  const base = {
    type: 'Attack' as const,
    attackerUnitId: opts.attackerUnitId,
    mode: opts.mode,
    ...(opts.targetUnitId !== undefined
      ? { targetUnitId: opts.targetUnitId }
      : {}),
    ...(opts.targetBuildingId !== undefined
      ? { targetBuildingId: opts.targetBuildingId }
      : {}),
  };
  return base as unknown as Action;
};

// ─── Happy path: melee ───────────────────────────────────────────────

describe('Attack — happy melee', () => {
  it('applies damage equal to attacker.card.melee, defender survives', () => {
    // Welsh infantry (melee 3) attacks Cataphract (health 7) adjacent.
    const attacker = makeUnit('u-eng-1', 'eng-welsh-infantry', 1, { x: 2, y: 2 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 3, y: 2 });
    const state = attackState([attacker, defender]);

    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newDefender = result.value.units.find((u) => u.id === uid('u-byz-1'));
    expect(newDefender).toBeDefined();
    expect(newDefender?.damage).toBe(3);
    // 3 < 7 — defender alive.
    expect(result.value.units).toHaveLength(2);
  });

  it('marks attacker as exhausted after a successful attack', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([attacker, defender]);

    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newAttacker = result.value.units.find((u) => u.id === uid('u-eng-1'));
    expect(newAttacker?.exhausted).toBe(true);
  });

  it('allows attacks on all 8 Chebyshev-1 neighbours (diagonals included)', () => {
    const diagonals: Array<{ x: number; y: number }> = [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 1, y: 2 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];

    for (const sq of diagonals) {
      const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 2, y: 2 });
      const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, sq);
      const state = attackState([attacker, defender]);
      const result = applyAction(
        state,
        attackAction({
          attackerUnitId: 'u-eng-1',
          targetUnitId: 'u-byz-1',
          mode: 'melee',
        }),
        SEAT_1,
      );
      expect(result.ok).toBe(true);
    }
  });
});

// ─── Happy path: ranged ──────────────────────────────────────────────

describe('Attack — happy ranged', () => {
  it('applies ranged damage to a non-adjacent target', () => {
    // Longbowman (ranged 3) attacks Cataphract (health 7) at Chebyshev 3.
    const attacker = makeUnit('u-eng-1', 'eng-longbowman', 1, { x: 0, y: 0 }, {
      attackMode: 'ranged',
    });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 3, y: 0 });
    const state = attackState([attacker, defender]);

    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'ranged',
      }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newDefender = result.value.units.find((u) => u.id === uid('u-byz-1'));
    expect(newDefender?.damage).toBe(3);
  });
});

// ─── Lethal damage ───────────────────────────────────────────────────

describe('Attack — lethal damage', () => {
  it('removes the defender from state.units when damage >= card.health', () => {
    // Cataphract (melee 4) vs Longbowman (health 2) — one-shot kill.
    const attacker = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 2, y: 2 });
    const defender = makeUnit('u-eng-1', 'eng-longbowman', 1, { x: 3, y: 2 });
    const state = attackState([attacker, defender], { activePlayer: SEAT_2 });

    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-byz-1',
        targetUnitId: 'u-eng-1',
        mode: 'melee',
      }),
      SEAT_2,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Defender removed, attacker remains (exhausted).
    expect(result.value.units).toHaveLength(1);
    expect(result.value.units[0]?.id).toBe(uid('u-byz-1'));
    expect(result.value.units[0]?.exhausted).toBe(true);
  });

  it('removes defender on exact-health damage (damage === health is lethal)', () => {
    // Welsh Infantry (melee 3) vs Longbowman with damage 0, health 2 →
    // 0 + 3 = 3 >= 2 → dies. Tests the `>=` boundary in one direction;
    // the next test covers cumulative-to-exact.
    const attacker = makeUnit('u-eng-1', 'eng-welsh-infantry', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 1, y: 0 }, {
      damage: 4, // 4 + welsh melee 3 = 7 === health 7 → exact kill
    });
    const state = attackState([attacker, defender]);

    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.units.find((u) => u.id === uid('u-byz-1'))).toBeUndefined();
  });

  it('accumulates damage across multiple non-lethal attacks', () => {
    // Manually applied twice via fresh attackers (one attacker = one
    // attack per turn). Watchman melee 1 vs Cataphract health 7 — bump
    // by 1, then bump by 1 again with another watchman.
    const a1 = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const a2 = makeUnit('u-eng-2', 'eng-watchman', 1, { x: 1, y: 1 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 1, y: 0 });
    const state = attackState([a1, a2, defender]);

    const r1 = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyAction(
      r1.value,
      attackAction({
        attackerUnitId: 'u-eng-2',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const finalDef = r2.value.units.find((u) => u.id === uid('u-byz-1'));
    expect(finalDef?.damage).toBe(2);
  });
});

// ─── Rejections ──────────────────────────────────────────────────────

describe('Attack — rejections', () => {
  it('rejects when attacker is not on the board (attacker_not_found)', () => {
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([defender]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-ghost',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('attacker_not_found');
  });

  it('rejects when attacker is owned by the opponent (attacker_not_yours)', () => {
    const attacker = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 0 });
    const defender = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 1 });
    const state = attackState([attacker, defender]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-byz-1',
        targetUnitId: 'u-eng-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('attacker_not_yours');
  });

  it('rejects when attacker is already exhausted (attacker_exhausted)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 }, {
      exhausted: true,
    });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([attacker, defender]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('attacker_exhausted');
  });

  it('rejects when target is not on the board (target_not_found)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = attackState([attacker]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-ghost',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('target_not_found');
  });

  it('rejects friendly fire (target_friendly)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const friend = makeUnit('u-eng-2', 'eng-watchman', 1, { x: 0, y: 1 });
    const state = attackState([attacker, friend]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-eng-2',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('target_friendly');
  });

  it('rejects self-attack (target_friendly)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = attackState([attacker]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-eng-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('target_friendly');
  });

  it('rejects when action.mode does not match attacker.attackMode (attack_mode_mismatch)', () => {
    // Attacker is in melee mode but action says ranged.
    const attacker = makeUnit('u-eng-1', 'eng-longbowman', 1, { x: 0, y: 0 }, {
      attackMode: 'melee',
    });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 3 });
    const state = attackState([attacker, defender]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'ranged',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('attack_mode_mismatch');
  });

  it('rejects when card has 0 attack value in the requested mode (attack_value_zero)', () => {
    // Longbowman has melee 0. Action mode == attacker.attackMode == melee.
    const attacker = makeUnit('u-eng-1', 'eng-longbowman', 1, { x: 0, y: 0 }, {
      attackMode: 'melee',
    });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([attacker, defender]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('attack_value_zero');
  });

  it('rejects melee attack on a non-adjacent target (out_of_range)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 2, y: 0 }); // Chebyshev 2
    const state = attackState([attacker, defender]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_range');
  });

  it('rejects ranged attack at adjacent distance (out_of_range)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-longbowman', 1, { x: 0, y: 0 }, {
      attackMode: 'ranged',
    });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 }); // Chebyshev 1
    const state = attackState([attacker, defender]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'ranged',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_range');
  });

  it('rejects building target (not_implemented — capital damage is MVP-4)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const state = attackState([attacker]);
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetBuildingId: 'b-cap-2',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_implemented');
  });

  it('rejects from the wrong phase (wrong_phase, via applyAction gate)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([attacker, defender], { phase: 'deployment' });
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('wrong_phase');
  });

  it('rejects from the wrong seat (not_your_turn, via applyAction gate)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([attacker, defender]); // active seat is 1
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_2,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not_your_turn');
  });
});

// ─── Invariants ──────────────────────────────────────────────────────

describe('Attack — invariants', () => {
  it('does not mutate the input state', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([attacker, defender]);
    const before = structuredClone(state);
    applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(state).toEqual(before);
  });

  it('preserves state.version (rules engine never bumps; Worker does)', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = { ...attackState([attacker, defender]), version: 11 };
    const result = applyAction(
      state,
      attackAction({
        attackerUnitId: 'u-eng-1',
        targetUnitId: 'u-byz-1',
        mode: 'melee',
      }),
      SEAT_1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe(11);
  });
});

// ─── Handler-direct (bypass gate) ────────────────────────────────────

describe('Attack — handler direct', () => {
  it('returns attacker_not_found for an unknown attacker id', () => {
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 0, y: 1 });
    const state = attackState([defender]);
    const action = attackAction({
      attackerUnitId: 'u-ghost',
      targetUnitId: 'u-byz-1',
      mode: 'melee',
    }) as Extract<Action, { type: 'Attack' }>;
    const result = attack(state, action, SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('attacker_not_found');
  });

  it('returns out_of_range for a melee attack at Chebyshev 2', () => {
    const attacker = makeUnit('u-eng-1', 'eng-watchman', 1, { x: 0, y: 0 });
    const defender = makeUnit('u-byz-1', 'byz-cataphract', 2, { x: 2, y: 0 });
    const state = attackState([attacker, defender]);
    const action = attackAction({
      attackerUnitId: 'u-eng-1',
      targetUnitId: 'u-byz-1',
      mode: 'melee',
    }) as Extract<Action, { type: 'Attack' }>;
    const result = attack(state, action, SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('out_of_range');
  });
});

// ─── @needs-confirmation ─────────────────────────────────────────────

describe.skip('Attack — @needs-confirmation', () => {
  it('TODO: ranged attacks should have an upper distance cap (e.g., 2 squares for short-range, 3+ for long-range archer keyword)', () => {
    // MVP-3 has no max range — a longbowman can shoot across the entire
    // 6x6 board. Confirm with Cassian / rulebook §"Combat" / archer keywords.
    expect(true).toBe(false);
  });

  it('TODO: line-of-sight / blocking-terrain should affect ranged attacks', () => {
    expect(true).toBe(false);
  });

  it('TODO: counter-attack — defender may strike back when attacked in melee', () => {
    expect(true).toBe(false);
  });

  it('TODO: keyword effects (Charge +N, Armor -N) modify damage', () => {
    expect(true).toBe(false);
  });
});
