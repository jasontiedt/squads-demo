import {
  type Action,
  type CardId,
  type GameState,
  type Player,
} from '@eoe/schema';
import { describe, expect, it, vi } from 'vitest';

// Mock the catalog BEFORE importing the rules under test. Mirrors
// `playTactic.test.ts` — small typed-effect catalog covering the
// happy path + every reject code.
vi.mock('@eoe/assets-meta', () => {
  return {
    loadCivMeta: (civ: string) => {
      if (civ !== 'english') return [];
      return [
        // Canonical Technology with class-wide-passive (stat-delta).
        {
          kind: 'technology',
          id: 'tech-iron-weapons' as CardId,
          name: 'Iron Weapons',
          civ: 'english',
          cost: { wild: 1 },
          subType: 'A',
          effect: {
            kind: 'class-wide-passive',
            classFilter: 'infantry',
            ownership: 'own',
            modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
          },
        },
        // Technology with class-wide-passive (keyword modifier).
        {
          kind: 'technology',
          id: 'tech-horse-training' as CardId,
          name: 'Horse Training',
          civ: 'english',
          cost: {},
          subType: 'B',
          effect: {
            kind: 'class-wide-passive',
            classFilter: 'cavalry',
            ownership: 'all',
            modifier: { kind: 'keyword', keyword: 'charge' },
          },
        },
        // Untyped-effect Technology — surfaces effect_not_typed.
        {
          kind: 'technology',
          id: 'tech-stub' as CardId,
          name: 'Placeholder Tech',
          civ: 'english',
          cost: {},
          subType: 'C',
          effect: 'PLACEHOLDER prose effect',
        },
        // Non-technology card — used for `not_a_technology` test.
        {
          kind: 'action',
          id: 'act-foo' as CardId,
          name: 'Foo Action',
          civ: 'english',
          cost: {},
          effect: { kind: 'draw', count: 1 },
        },
      ];
    },
  };
});

// Imports must be AFTER vi.mock to ensure the mocked module is wired.
const { applyAction } = await import('../applyAction.js');
const { baseState, SEAT_1, SEAT_2 } = await import('./fixtures.js');

// ─────────────────────────── PlayTechnology (Issue #99) ──────────────

const cid = (s: string): CardId => s as CardId;

function stateWithHand(
  hand: ReadonlyArray<CardId>,
  resources: Player['resources'] = [],
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
  };
}

const playTechnology = (cardId: CardId): Action =>
  ({ type: 'PlayTechnology', cardId }) as unknown as Action;

describe('PlayTechnology — issue #99 (MVP-6 S3)', () => {
  it('happy path: pays cost, moves hand→discard, registers class-wide-passive (stat-delta)', () => {
    const before = stateWithHand(
      [cid('tech-iron-weapons')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
    );

    const result = applyAction(
      before,
      playTechnology(cid('tech-iron-weapons')),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.players[SEAT_1];
    expect(after).toBeDefined();
    if (after === undefined) return;
    // Card moved hand → discard.
    expect(after.hand).not.toContain(cid('tech-iron-weapons'));
    expect(after.discard).toContain(cid('tech-iron-weapons'));
    // Cost exhausted.
    expect(after.resources[0]?.exhausted).toBe(true);
    // Registration appended with the actor's seat.
    expect(result.value.classWidePassives).toHaveLength(1);
    expect(result.value.classWidePassives?.[0]).toMatchObject({
      seat: 1,
      classFilter: 'infantry',
      ownership: 'own',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
    });
  });

  it('happy path: keyword-modifier technology registers append-only', () => {
    const before = stateWithHand([cid('tech-horse-training')]);
    const result = applyAction(
      before,
      playTechnology(cid('tech-horse-training')),
      SEAT_1,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.classWidePassives?.[0]).toMatchObject({
      seat: 1,
      classFilter: 'cavalry',
      ownership: 'all',
      modifier: { kind: 'keyword', keyword: 'charge' },
    });
  });

  it('card_not_in_hand: technology not in seat hand → err', () => {
    const before = stateWithHand([cid('some-other-card')]);
    const result = applyAction(
      before,
      playTechnology(cid('tech-iron-weapons')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_hand');
  });

  it('not_a_technology: action card played via PlayTechnology → err', () => {
    const before = stateWithHand([cid('act-foo')]);
    const result = applyAction(before, playTechnology(cid('act-foo')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_a_technology');
  });

  it('effect_not_typed: untyped catalog effect → err', () => {
    const before = stateWithHand([cid('tech-stub')]);
    const result = applyAction(before, playTechnology(cid('tech-stub')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('effect_not_typed');
  });

  it('wrong_phase: PlayTechnology in mobilization → err', () => {
    const before = stateWithHand(
      [cid('tech-iron-weapons')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
      'mobilization',
    );
    const result = applyAction(
      before,
      playTechnology(cid('tech-iron-weapons')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('insufficient_resources: cannot pay cost → original state preserved', () => {
    const before = stateWithHand([cid('tech-iron-weapons')]);
    const snapshot = JSON.parse(JSON.stringify(before));
    const result = applyAction(
      before,
      playTechnology(cid('tech-iron-weapons')),
      SEAT_1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_resources');
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('not_your_turn: non-active seat plays technology → err', () => {
    const before = stateWithHand([cid('tech-iron-weapons')]);
    const result = applyAction(
      before,
      playTechnology(cid('tech-iron-weapons')),
      SEAT_2,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });
});
