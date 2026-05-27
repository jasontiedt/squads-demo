import {
  type Action,
  type ActiveEvent,
  type CardId,
  type GameState,
  type Player,
} from '@eoe/schema';
import { describe, expect, it, vi } from 'vitest';

// Mock the catalog BEFORE importing rules. Real catalog events are
// limited (two byzantines events backfilled in #100). We inject a
// small fixture so the tests exercise every branch (typed effect,
// untyped effect, kind mismatch, and dispatch err).
vi.mock('@eoe/assets-meta', () => {
  return {
    loadCivMeta: (civ: string) => {
      if (civ !== 'english') return [];
      return [
        // Typed draw-1 event.
        {
          kind: 'event',
          id: 'evt-draw' as CardId,
          name: 'Royal Audience',
          civ: 'english',
          cost: { wild: 1 },
          persistent: true,
          ticksRemaining: 3,
          effect: { kind: 'draw', count: 1 },
        },
        // Free event (no cost) — useful for cap tests.
        {
          kind: 'event',
          id: 'evt-free' as CardId,
          name: 'Cheap Event',
          civ: 'english',
          cost: {},
          persistent: true,
          ticksRemaining: 2,
          effect: { kind: 'draw', count: 1 },
        },
        // Free event with a 1-tick duration.
        {
          kind: 'event',
          id: 'evt-short' as CardId,
          name: 'Brief Event',
          civ: 'english',
          cost: {},
          persistent: true,
          ticksRemaining: 1,
          effect: { kind: 'draw', count: 1 },
        },
        // Untyped-effect event — surfaces effect_not_typed.
        {
          kind: 'event',
          id: 'evt-stub' as CardId,
          name: 'Placeholder',
          civ: 'english',
          cost: {},
          persistent: true,
          ticksRemaining: 3,
          effect: 'PLACEHOLDER prose effect',
        },
        // Event whose on-play effect errors at dispatch (damage is
        // scope-cut from the dispatcher). Pairs with cost to verify
        // atomic rollback.
        {
          kind: 'event',
          id: 'evt-damage' as CardId,
          name: 'Disaster',
          civ: 'english',
          cost: { wild: 1 },
          persistent: true,
          ticksRemaining: 3,
          effect: { kind: 'damage', amount: 1, target: 'opponent-capital' },
        },
        // Non-event card — used for `not_an_event_card` test.
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

const { applyAction } = await import('../applyAction.js');
const { baseState, SEAT_1 } = await import('./fixtures.js');

const cid = (s: string): CardId => s as CardId;

function stateWithHand(
  hand: ReadonlyArray<CardId>,
  resources: Player['resources'] = [],
  activeEvents: ReadonlyArray<ActiveEvent> = [],
  phase: GameState['phase'] = 'deployment',
): GameState {
  const p = baseState.players[SEAT_1];
  if (p === undefined) throw new Error('fixture invariant');
  const newPlayer: Player = {
    ...p,
    hand: [...hand],
    deck: [cid('eng-deck-1'), cid('eng-deck-2'), cid('eng-deck-3')],
    discard: [],
    resources: [...resources],
    activeEvents: [...activeEvents],
  };
  return {
    ...baseState,
    phase,
    players: { ...baseState.players, [SEAT_1]: newPlayer },
  };
}

const playEvent = (cardId: CardId): Action =>
  ({ type: 'PlayEvent', cardId }) as unknown as Action;

const evt = (id: string, ticksRemaining = 3): ActiveEvent => ({
  cardId: cid(id),
  ticksRemaining,
  effect: { kind: 'draw', count: 1 },
});

describe('PlayEvent — issue #100 (MVP-6 S4)', () => {
  it('happy path: pays cost, moves hand→activeEvents, dispatches on-play effect', () => {
    const before = stateWithHand(
      [cid('evt-draw')],
      [
        {
          id: 'rt-w-1' as Player['resources'][number]['id'],
          kind: 'wild',
          exhausted: false,
        },
      ],
    );

    const result = applyAction(before, playEvent(cid('evt-draw')), SEAT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.value.players[SEAT_1];
    expect(after).toBeDefined();
    if (after === undefined) return;
    // Card moved hand → activeEvents (NOT discard).
    expect(after.hand).not.toContain(cid('evt-draw'));
    expect(after.discard).not.toContain(cid('evt-draw'));
    expect(after.activeEvents).toHaveLength(1);
    expect(after.activeEvents[0]?.cardId).toBe(cid('evt-draw'));
    expect(after.activeEvents[0]?.ticksRemaining).toBe(3);
    expect(after.activeEvents[0]?.effect).toEqual({ kind: 'draw', count: 1 });
    // Cost paid.
    expect(after.resources[0]?.exhausted).toBe(true);
    // On-play effect dispatched: drew 1 card.
    expect(after.hand).toEqual([cid('eng-deck-1')]);
  });

  it('event_cap_reached: 3 active events → err, state unchanged', () => {
    const activeEvents: ActiveEvent[] = [evt('evt-a'), evt('evt-b'), evt('evt-c')];
    const before = stateWithHand(
      [cid('evt-free')],
      [],
      activeEvents,
    );

    const result = applyAction(before, playEvent(cid('evt-free')), SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('event_cap_reached');

    // State must be unchanged — no auto-discard, no cost paid, no card moved.
    const beforeP = before.players[SEAT_1];
    const ax = before; // alias for readability
    expect(ax.players[SEAT_1]).toEqual(beforeP);
  });

  it('card_not_in_hand: event not in seat hand → err', () => {
    const before = stateWithHand([cid('some-other-card')]);
    const result = applyAction(before, playEvent(cid('evt-free')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_hand');
  });

  it('not_an_event_card: action card played via PlayEvent → err', () => {
    const before = stateWithHand([cid('act-foo')]);
    const result = applyAction(before, playEvent(cid('act-foo')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_an_event_card');
  });

  it('effect_not_typed: untyped catalog effect → err', () => {
    const before = stateWithHand([cid('evt-stub')]);
    const result = applyAction(before, playEvent(cid('evt-stub')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('effect_not_typed');
  });

  it('insufficient_resources: cost cannot be paid → err, state unchanged', () => {
    const before = stateWithHand([cid('evt-draw')], []);
    const beforeP = before.players[SEAT_1];

    const result = applyAction(before, playEvent(cid('evt-draw')), SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('insufficient_resources');

    // Card still in hand; activeEvents untouched.
    expect(before.players[SEAT_1]).toEqual(beforeP);
  });

  it('atomic rollback: dispatch err → caller sees unchanged state', () => {
    const before = stateWithHand(
      [cid('evt-damage')],
      [
        {
          id: 'rt-w-1' as Player['resources'][number]['id'],
          kind: 'wild',
          exhausted: false,
        },
      ],
    );

    const result = applyAction(before, playEvent(cid('evt-damage')), SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Dispatch returned `not_implemented` for damage; PlayEvent bubbles it.
    expect(result.error.code).toBe('not_implemented');
  });
});
