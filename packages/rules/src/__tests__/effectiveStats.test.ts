import {
  type CardId,
  type ClassWidePassiveRegistration,
  type GameState,
  type UnitInstance,
  type UnitInstanceId,
} from '@eoe/schema';
import { describe, expect, it, vi } from 'vitest';

// Mock the catalog BEFORE importing the rule under test. Two unit
// cards cover the class-passive selector matrix; no other card kinds
// needed here.
vi.mock('@eoe/assets-meta', () => {
  // Return the same two unit cards for any civ so seat-2 (byzantines)
  // fixture units can be looked up too. Catalog drift is not the
  // subject of these tests.
  const cards = [
    {
      kind: 'unit',
      id: 'eng-unit-infantry' as CardId,
      name: 'Footman',
      civ: 'english',
      cost: {},
      movement: { points: 1 },
      melee: 2,
      ranged: 0,
      health: 3,
      class: ['infantry'],
      keywords: ['steadfast'],
    },
    {
      kind: 'unit',
      id: 'eng-unit-cavalry' as CardId,
      name: 'Rider',
      civ: 'english',
      cost: {},
      movement: { points: 2 },
      melee: 2,
      ranged: 0,
      health: 2,
      class: ['cavalry'],
      keywords: [],
    },
  ];
  return {
    loadCivMeta: () => cards,
  };
});

const { effectiveStats } = await import('../effectiveStats.js');
const { baseState } = await import('./fixtures.js');

// ─────────────────────────── effectiveStats (Issue #99) ──────────────

const cid = (s: string): CardId => s as CardId;
const uid = (s: string): UnitInstanceId => s as UnitInstanceId;

function infantry(id: string, owner: 1 | 2 = 1): UnitInstance {
  return {
    id: uid(id),
    cardId: cid('eng-unit-infantry'),
    owner,
    square: { x: 0, y: 0 },
    exhausted: false,
    damage: 0,
    attackMode: 'melee',
    upgrades: [],
  };
}

function stateWith(
  units: ReadonlyArray<UnitInstance>,
  passives: ReadonlyArray<ClassWidePassiveRegistration> = [],
): GameState {
  return {
    ...baseState,
    units: [...units],
    classWidePassives: passives.length > 0 ? [...passives] : undefined,
  };
}

describe('effectiveStats — issue #99 (MVP-6 S3)', () => {
  it('returns base card stats when no modifiers apply', () => {
    const u = infantry('u-1');
    const state = stateWith([u]);
    const eff = effectiveStats(u, state);
    expect(eff).toBeDefined();
    expect(eff).toEqual({
      melee: 2,
      ranged: 0,
      health: 3,
      movement: 1,
      keywords: ['steadfast'],
    });
  });

  it('applies own class-wide stat-delta to matching unit', () => {
    const u = infantry('u-1', 1);
    const passive: ClassWidePassiveRegistration = {
      seat: 1,
      classFilter: 'infantry',
      ownership: 'own',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
    };
    const eff = effectiveStats(u, stateWith([u], [passive]));
    expect(eff?.melee).toBe(3);
  });

  it("does NOT apply 'own' passive to opponent's matching unit", () => {
    const enemy = infantry('u-enemy', 2);
    const passive: ClassWidePassiveRegistration = {
      seat: 1, // registered by seat 1
      classFilter: 'infantry',
      ownership: 'own',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
    };
    const eff = effectiveStats(enemy, stateWith([enemy], [passive]));
    expect(eff?.melee).toBe(2);
  });

  it("applies 'opponent' passive only to non-registering seat's units", () => {
    const own = infantry('u-own', 1);
    const enemy = infantry('u-enemy', 2);
    const passive: ClassWidePassiveRegistration = {
      seat: 1,
      classFilter: 'infantry',
      ownership: 'opponent',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: -1 },
    };
    const state = stateWith([own, enemy], [passive]);
    expect(effectiveStats(own, state)?.melee).toBe(2);
    expect(effectiveStats(enemy, state)?.melee).toBe(1);
  });

  it("applies 'all' passive regardless of owner", () => {
    const own = infantry('u-own', 1);
    const enemy = infantry('u-enemy', 2);
    const passive: ClassWidePassiveRegistration = {
      seat: 1,
      classFilter: 'infantry',
      ownership: 'all',
      modifier: { kind: 'stat-delta', stat: 'health', delta: 2 },
    };
    const state = stateWith([own, enemy], [passive]);
    expect(effectiveStats(own, state)?.health).toBe(5);
    expect(effectiveStats(enemy, state)?.health).toBe(5);
  });

  it('skips passive when classFilter does not match unit class', () => {
    const u = infantry('u-1');
    const passive: ClassWidePassiveRegistration = {
      seat: 1,
      classFilter: 'cavalry', // unit is infantry
      ownership: 'all',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: 5 },
    };
    const eff = effectiveStats(u, stateWith([u], [passive]));
    expect(eff?.melee).toBe(2);
  });

  it('keyword-modifier passive adds to keywords list', () => {
    const u = infantry('u-1');
    const passive: ClassWidePassiveRegistration = {
      seat: 1,
      classFilter: 'infantry',
      ownership: 'own',
      modifier: { kind: 'keyword', keyword: 'pierce' },
    };
    const eff = effectiveStats(u, stateWith([u], [passive]));
    expect(eff?.keywords).toContain('pierce');
    expect(eff?.keywords).toContain('steadfast'); // base keyword preserved
  });

  it('unit attachments contribute keywords (not stats)', () => {
    const u: UnitInstance = {
      ...infantry('u-1'),
      attachments: [{ keyword: 'first-strike' }, { keyword: 'pierce' }],
    };
    const eff = effectiveStats(u, stateWith([u]));
    expect(eff?.keywords).toEqual(['steadfast', 'first-strike', 'pierce']);
    // Stats unchanged by attachments.
    expect(eff?.melee).toBe(2);
    expect(eff?.health).toBe(3);
  });

  it('temporary buffs stack additively on top of base stats', () => {
    const u: UnitInstance = {
      ...infantry('u-1'),
      temporaryBuffs: [
        { stat: 'melee', delta: 1, expires: 'end-of-turn' },
        { stat: 'melee', delta: 2, expires: 'end-of-turn' },
        { stat: 'health', delta: -1, expires: 'end-of-turn' },
      ],
    };
    const eff = effectiveStats(u, stateWith([u]));
    expect(eff?.melee).toBe(5); // 2 + 1 + 2
    expect(eff?.health).toBe(2); // 3 - 1
  });

  it('composes class-wide passive + temporary buff + attachment in one go', () => {
    const passive: ClassWidePassiveRegistration = {
      seat: 1,
      classFilter: 'infantry',
      ownership: 'own',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
    };
    const u: UnitInstance = {
      ...infantry('u-1'),
      attachments: [{ keyword: 'first-strike' }],
      temporaryBuffs: [{ stat: 'melee', delta: 1, expires: 'end-of-turn' }],
    };
    const eff = effectiveStats(u, stateWith([u], [passive]));
    expect(eff?.melee).toBe(4); // 2 base + 1 passive + 1 buff
    expect(eff?.keywords).toEqual(['steadfast', 'first-strike']);
  });

  it('returns undefined when catalog lookup fails (state drift)', () => {
    const orphan: UnitInstance = {
      ...infantry('u-1'),
      cardId: cid('nonexistent-card'),
    };
    const eff = effectiveStats(orphan, stateWith([orphan]));
    expect(eff).toBeUndefined();
  });
});
