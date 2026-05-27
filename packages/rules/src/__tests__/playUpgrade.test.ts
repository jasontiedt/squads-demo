import {
  type Action,
  type CardId,
  type GameState,
  type Player,
  type UnitInstance,
  type UnitInstanceId,
} from '@eoe/schema';
import { describe, expect, it, vi } from 'vitest';

// Mock the catalog BEFORE importing the rules under test. Mirrors the
// `playTactic.test.ts` strategy — we inject a small typed-effect
// catalog so happy paths exercise the dispatcher end-to-end without
// depending on the real catalog data shape.
vi.mock('@eoe/assets-meta', () => {
  return {
    loadCivMeta: (civ: string) => {
      if (civ !== 'english') return [];
      return [
        // Canonical Upgrade with attach-keyword effect, ANY unit class.
        {
          kind: 'upgrade',
          id: 'upg-first-strike' as CardId,
          name: 'Sharpened Blades',
          civ: 'english',
          cost: { wild: 1 },
          // Catalog-side placeholder unitId — handler rewrites with
          // action.targetUnitId before dispatching.
          effect: {
            kind: 'attach-keyword',
            target: { kind: 'unit', unitId: 'PLACEHOLDER' },
            keyword: 'first-strike',
          },
        },
        // Class-restricted Upgrade — only attaches to 'infantry'.
        {
          kind: 'upgrade',
          id: 'upg-shield' as CardId,
          name: 'Iron Shield',
          civ: 'english',
          cost: {},
          restrictedToClass: ['infantry'],
          effect: {
            kind: 'attach-keyword',
            target: { kind: 'unit', unitId: 'PLACEHOLDER' },
            keyword: 'pierce',
          },
        },
        // Untyped-effect Upgrade — surfaces effect_not_typed.
        {
          kind: 'upgrade',
          id: 'upg-stub' as CardId,
          name: 'Placeholder Upgrade',
          civ: 'english',
          cost: {},
          effect: 'PLACEHOLDER prose effect',
        },
        // Non-upgrade card — used for `not_an_upgrade` test.
        {
          kind: 'action',
          id: 'act-foo' as CardId,
          name: 'Foo Action',
          civ: 'english',
          cost: {},
          effect: { kind: 'draw', count: 1 },
        },
        // Unit cards backing the target units in tests.
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
          keywords: [],
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
    },
  };
});

// Imports must be AFTER vi.mock to ensure the mocked module is wired.
const { applyAction } = await import('../applyAction.js');
const { baseState, SEAT_1, SEAT_2 } = await import('./fixtures.js');

// ─────────────────────────── PlayUpgrade (Issue #99) ─────────────────

const cid = (s: string): CardId => s as CardId;
const uid = (s: string): UnitInstanceId => s as UnitInstanceId;

function infantryUnit(id: string, owner: 1 | 2): UnitInstance {
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

function cavalryUnit(id: string, owner: 1 | 2): UnitInstance {
  return {
    id: uid(id),
    cardId: cid('eng-unit-cavalry'),
    owner,
    square: { x: 0, y: 0 },
    exhausted: false,
    damage: 0,
    attackMode: 'melee',
    upgrades: [],
  };
}

function stateWithHand(
  hand: ReadonlyArray<CardId>,
  resources: Player['resources'] = [],
  units: ReadonlyArray<UnitInstance> = [],
  phase: GameState['phase'] = 'deployment',
): GameState {
  const p = baseState.players[SEAT_1];
  if (p === undefined) throw new Error('fixture invariant');
  const newPlayer: Player = {
    ...p,
    hand: [...hand],
    deck: [],
    discard: [],
    resources: [...resources],
  };
  return {
    ...baseState,
    phase,
    players: { ...baseState.players, [SEAT_1]: newPlayer },
    units: [...units],
  };
}

const playUpgrade = (cardId: CardId, targetUnitId: UnitInstanceId): Action =>
  ({ type: 'PlayUpgrade', cardId, targetUnitId }) as unknown as Action;

describe('PlayUpgrade — issue #99 (MVP-6 S3)', () => {
  it('happy path: pays cost, moves hand→discard, attaches keyword to target unit', () => {
    const u = infantryUnit('u-1', 1);
    const before = stateWithHand(
      [cid('upg-first-strike')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
      [u],
    );

    const result = applyAction(
      before,
      playUpgrade(cid('upg-first-strike'), uid('u-1')),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.players[SEAT_1];
    expect(after).toBeDefined();
    if (after === undefined) return;
    // Card moved hand → discard.
    expect(after.hand).not.toContain(cid('upg-first-strike'));
    expect(after.discard).toContain(cid('upg-first-strike'));
    // Cost exhausted.
    expect(after.resources[0]?.exhausted).toBe(true);
    // Target unit got the keyword attachment with the action's unitId
    // (not the catalog PLACEHOLDER).
    const target = result.value.units.find((x) => x.id === uid('u-1'));
    expect(target?.attachments).toEqual([{ keyword: 'first-strike' }]);
  });

  it('class-restricted upgrade attaches to matching class', () => {
    const u = infantryUnit('u-1', 1);
    const before = stateWithHand([cid('upg-shield')], [], [u]);
    const result = applyAction(
      before,
      playUpgrade(cid('upg-shield'), uid('u-1')),
      SEAT_1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const target = result.value.units.find((x) => x.id === uid('u-1'));
    expect(target?.attachments).toEqual([{ keyword: 'pierce' }]);
  });

  it('upgrade_class_mismatch: class-restricted upgrade on wrong class → err', () => {
    const u = cavalryUnit('u-1', 1); // upg-shield restricted to 'infantry'
    const before = stateWithHand([cid('upg-shield')], [], [u]);
    const result = applyAction(
      before,
      playUpgrade(cid('upg-shield'), uid('u-1')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('upgrade_class_mismatch');
  });

  it('card_not_in_hand: upgrade not in seat hand → err', () => {
    const u = infantryUnit('u-1', 1);
    const before = stateWithHand([cid('some-other-card')], [], [u]);
    const result = applyAction(
      before,
      playUpgrade(cid('upg-first-strike'), uid('u-1')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_hand');
  });

  it('not_an_upgrade: action card played via PlayUpgrade → err', () => {
    const u = infantryUnit('u-1', 1);
    const before = stateWithHand([cid('act-foo')], [], [u]);
    const result = applyAction(
      before,
      playUpgrade(cid('act-foo'), uid('u-1')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_an_upgrade');
  });

  it('target_not_found: target unit not on the board → err', () => {
    const before = stateWithHand(
      [cid('upg-first-strike')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
      [], // no units
    );
    const result = applyAction(
      before,
      playUpgrade(cid('upg-first-strike'), uid('u-missing')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('target_not_found');
  });

  it('target_not_yours: target unit owned by another seat → err', () => {
    const enemy = infantryUnit('u-enemy', 2);
    const before = stateWithHand(
      [cid('upg-first-strike')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
      [enemy],
    );
    const result = applyAction(
      before,
      playUpgrade(cid('upg-first-strike'), uid('u-enemy')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('target_not_yours');
  });

  it('effect_not_typed: untyped catalog effect → err', () => {
    const u = infantryUnit('u-1', 1);
    const before = stateWithHand([cid('upg-stub')], [], [u]);
    const result = applyAction(
      before,
      playUpgrade(cid('upg-stub'), uid('u-1')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('effect_not_typed');
  });

  it('wrong_phase: PlayUpgrade in mobilization → err', () => {
    const u = infantryUnit('u-1', 1);
    const before = stateWithHand(
      [cid('upg-first-strike')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
      [u],
      'mobilization',
    );
    const result = applyAction(
      before,
      playUpgrade(cid('upg-first-strike'), uid('u-1')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('insufficient_resources: cannot pay cost → original state preserved', () => {
    const u = infantryUnit('u-1', 1);
    // upg-first-strike costs { wild: 1 }; no resources at all here.
    const before = stateWithHand([cid('upg-first-strike')], [], [u]);
    const snapshot = JSON.parse(JSON.stringify(before));
    const result = applyAction(
      before,
      playUpgrade(cid('upg-first-strike'), uid('u-1')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_resources');
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('not_your_turn: non-active seat plays upgrade → err', () => {
    const u = infantryUnit('u-1', 1);
    const before = stateWithHand([cid('upg-first-strike')], [], [u]);
    const result = applyAction(
      before,
      playUpgrade(cid('upg-first-strike'), uid('u-1')),
      SEAT_2,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });
});
