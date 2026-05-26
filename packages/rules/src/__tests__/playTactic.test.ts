import {
  type Action,
  type CardId,
  type GameState,
  type Player,
  type UnitInstance,
  type UnitInstanceId,
} from '@eoe/schema';
import { describe, expect, it, vi } from 'vitest';

// Mock the catalog BEFORE importing the rules under test. The real
// catalog data ships only string-effect tactic cards (see
// `eng-shield-wall`), which would surface as `effect_not_typed`. We
// inject a small typed-effect catalog so the happy path exercises the
// dispatcher end-to-end.
vi.mock('@eoe/assets-meta', () => {
  return {
    loadCivMeta: (civ: string) => {
      if (civ !== 'english') return [];
      return [
        // Typed draw-2 tactic, playable in both phases.
        {
          kind: 'tactic',
          id: 'tact-draw-2' as CardId,
          name: 'Levy',
          civ: 'english',
          cost: { wild: 1 },
          playableIn: ['mobilization', 'deployment'],
          effect: { kind: 'draw', count: 2 },
        },
        // Deployment-only buff tactic (used for playableIn test).
        {
          kind: 'tactic',
          id: 'tact-buff-melee' as CardId,
          name: 'Battle Cry',
          civ: 'english',
          cost: {},
          playableIn: ['deployment'],
          effect: {
            kind: 'buff-unit-stat',
            stat: 'melee',
            delta: 1,
            target: { kind: 'all-own-units' },
          },
        },
        // Untyped-effect tactic — surfaces effect_not_typed.
        {
          kind: 'tactic',
          id: 'tact-stub' as CardId,
          name: 'Placeholder',
          civ: 'english',
          cost: {},
          playableIn: ['mobilization', 'deployment'],
          effect: 'PLACEHOLDER prose effect',
        },
        // Effect dispatch that errors (damage is scope-cut from #85).
        // Pairs with cost to verify atomic rollback on dispatch err.
        {
          kind: 'tactic',
          id: 'tact-damage' as CardId,
          name: 'Skirmish',
          civ: 'english',
          cost: { wild: 1 },
          playableIn: ['mobilization', 'deployment'],
          effect: {
            kind: 'damage',
            amount: 1,
            target: 'opponent-capital',
          },
        },
        // Non-tactic card — used for `not_a_tactic` test.
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

// ─────────────────────────── PlayTactic (Issue #86) ──────────────────

const cid = (s: string): CardId => s as CardId;

function stateWithHand(
  hand: ReadonlyArray<CardId>,
  resources: Player['resources'] = [],
  units: ReadonlyArray<UnitInstance> = [],
  phase: GameState['phase'] = 'mobilization',
): GameState {
  const p = baseState.players[SEAT_1];
  if (p === undefined) throw new Error('fixture invariant');
  const newPlayer: Player = {
    ...p,
    hand: [...hand],
    deck: [cid('eng-deck-1'), cid('eng-deck-2'), cid('eng-deck-3')],
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

const playTactic = (cardId: CardId): Action =>
  ({ type: 'PlayTactic', cardId }) as unknown as Action;

describe('PlayTactic — issue #86', () => {
  it('happy path: pays cost, moves hand→discard, dispatches draw effect', () => {
    const before = stateWithHand([cid('tact-draw-2')], [
      { id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false },
    ]);

    const result = applyAction(before, playTactic(cid('tact-draw-2')), SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value.players[SEAT_1];
    expect(after).toBeDefined();
    if (after === undefined) return;
    // Card moved hand → discard.
    expect(after.hand).not.toContain(cid('tact-draw-2'));
    expect(after.discard).toContain(cid('tact-draw-2'));
    // Cost exhausted.
    expect(after.resources[0]?.exhausted).toBe(true);
    // Effect dispatched: 2 cards drawn into hand.
    expect(after.hand.length).toBe(2);
    expect(after.hand).toEqual([cid('eng-deck-1'), cid('eng-deck-2')]);
  });

  it('card_not_in_hand: tactic not in seat hand → err', () => {
    const before = stateWithHand([cid('some-other-card')]);
    const result = applyAction(before, playTactic(cid('tact-draw-2')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_hand');
  });

  it("not_a_tactic: action card played via PlayTactic → err", () => {
    const before = stateWithHand([cid('act-foo')]);
    const result = applyAction(before, playTactic(cid('act-foo')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_a_tactic');
  });

  it('effect_not_typed: untyped catalog effect → err', () => {
    const before = stateWithHand([cid('tact-stub')]);
    const result = applyAction(before, playTactic(cid('tact-stub')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('effect_not_typed');
  });

  it('wrong_phase: deployment-only tactic played in mobilization → err', () => {
    const before = stateWithHand([cid('tact-buff-melee')], [], [], 'mobilization');
    const result = applyAction(before, playTactic(cid('tact-buff-melee')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('atomic rollback: dispatch err → caller sees unchanged state (cost not paid, card still in hand)', () => {
    // `tact-damage` dispatches the `damage` verb, which is scope-cut
    // from #85 and returns `not_implemented`. The cost is { wild: 1 }
    // and the only resource is one unexhausted wild token.
    const before = stateWithHand([cid('tact-damage')], [
      { id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false },
    ]);
    const snapshot = JSON.parse(JSON.stringify(before));

    const result = applyAction(before, playTactic(cid('tact-damage')), SEAT_1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_implemented');
    // Pre-state deep-equal post-state: the err bubble effectively
    // discards the intermediate hand/discard/cost mutation. The caller
    // never sees a partial application.
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('insufficient_resources: cost cannot be paid → original state preserved', () => {
    // tact-draw-2 costs { wild: 1 }; no resources at all here.
    const before = stateWithHand([cid('tact-draw-2')]);
    const snapshot = JSON.parse(JSON.stringify(before));

    const result = applyAction(before, playTactic(cid('tact-draw-2')), SEAT_1);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_resources');
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('not_your_turn: non-active seat plays tactic → err', () => {
    const before = stateWithHand([cid('tact-draw-2')]);
    const result = applyAction(before, playTactic(cid('tact-draw-2')), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });
});

// ─────────────────────────── EndTurn buff cleanup (Issue #86) ────────

const buffedUnit = (
  id: string,
  owner: 1 | 2,
  buffs: ReadonlyArray<{ stat: 'melee' | 'ranged' | 'health'; delta: number; expires: 'end-of-turn' }>,
): UnitInstance => ({
  id: id as UnitInstanceId,
  cardId: cid('eng-unit-archer'),
  owner,
  square: { x: 0, y: 0 },
  exhausted: false,
  damage: 0,
  attackMode: 'melee',
  upgrades: [],
  temporaryBuffs: [...buffs],
});

describe('EndTurn — temporaryBuffs cleanup (#86)', () => {
  it('strips buffs with expires: end-of-turn from active-seat units', () => {
    const u = buffedUnit('u-1', 1, [
      { stat: 'melee', delta: 1, expires: 'end-of-turn' },
    ]);
    const state: GameState = {
      ...baseState,
      phase: 'end',
      activePlayer: 1,
      units: [u],
    };

    const result = applyAction(state, { type: 'EndTurn' } as unknown as Action, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const afterUnit = result.value.units.find((x) => x.id === u.id);
    expect(afterUnit).toBeDefined();
    // Buff stripped — field dropped entirely when empty.
    expect(afterUnit?.temporaryBuffs).toBeUndefined();
  });

  it('strips end-of-turn buffs from enemy units too (interpretation pinned)', () => {
    // needs-confirmation: rulebook's "until end of turn" is interpreted
    // as the current player's EndTurn regardless of unit ownership.
    // The schema header comment scopes cleanup to "active player's
    // units"; this test pins the broader interpretation. Revisit when
    // rulebook OCR clarifies multi-seat buff durations (#17 / future).
    const own = buffedUnit('u-own', 1, [
      { stat: 'melee', delta: 1, expires: 'end-of-turn' },
    ]);
    const enemy = buffedUnit('u-enemy', 2, [
      { stat: 'health', delta: -1, expires: 'end-of-turn' },
    ]);
    const state: GameState = {
      ...baseState,
      phase: 'end',
      activePlayer: 1,
      units: [own, enemy],
    };

    const result = applyAction(state, { type: 'EndTurn' } as unknown as Action, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const u of result.value.units) {
      expect(u.temporaryBuffs).toBeUndefined();
    }
  });

  it('preserves units without temporaryBuffs (no-op path)', () => {
    const u: UnitInstance = {
      id: 'u-clean' as UnitInstanceId,
      cardId: cid('eng-unit-archer'),
      owner: 1,
      square: { x: 0, y: 0 },
      exhausted: false,
      damage: 0,
      attackMode: 'melee',
      upgrades: [],
    };
    const state: GameState = {
      ...baseState,
      phase: 'end',
      activePlayer: 1,
      units: [u],
    };

    const result = applyAction(state, { type: 'EndTurn' } as unknown as Action, SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.units[0]?.temporaryBuffs).toBeUndefined();
  });

  it('does not mutate the input state', () => {
    const u = buffedUnit('u-1', 1, [
      { stat: 'melee', delta: 1, expires: 'end-of-turn' },
    ]);
    const state: GameState = {
      ...baseState,
      phase: 'end',
      activePlayer: 1,
      units: [u],
    };
    const snapshot = JSON.stringify(state);

    applyAction(state, { type: 'EndTurn' } as unknown as Action, SEAT_1);

    expect(JSON.stringify(state)).toBe(snapshot);
  });
});
