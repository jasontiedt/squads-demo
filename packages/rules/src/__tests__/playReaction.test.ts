import {
  type Action,
  type CardId,
  type GameState,
  type Player,
  type Seat,
} from '@eoe/schema';
import { describe, expect, it, vi } from 'vitest';

// Mock the catalog BEFORE importing the rules under test. We inject a
// small typed-effect reaction catalog so the happy path exercises the
// dispatcher end-to-end. The reactor seat in these tests is SEAT_2
// (byzantines) — see fixtures: SEAT_1 is activePlayer, so reactions
// belong to SEAT_2.
vi.mock('@eoe/assets-meta', () => {
  return {
    loadCivMeta: (civ: string) => {
      if (civ !== 'byzantines') return [];
      return [
        // Typed draw-1 reaction triggered by an attack declaration.
        {
          kind: 'reaction',
          id: 'reac-on-attack-draw' as CardId,
          name: 'Counterscout',
          civ: 'byzantines',
          cost: { wild: 1 },
          trigger: { kind: 'on-attack-declared' },
          effect: { kind: 'draw', count: 1 },
        },
        // Free reaction on a different trigger — used for trigger_mismatch.
        {
          kind: 'reaction',
          id: 'reac-on-damage-draw' as CardId,
          name: 'Bandage',
          civ: 'byzantines',
          cost: {},
          trigger: { kind: 'on-damage-dealt' },
          effect: { kind: 'draw', count: 1 },
        },
        // Reaction whose effect dispatch errors (damage is scope-cut).
        // Pairs with a cost to verify atomic rollback.
        {
          kind: 'reaction',
          id: 'reac-damage-bomb' as CardId,
          name: 'Greek Fire',
          civ: 'byzantines',
          cost: { wild: 1 },
          trigger: { kind: 'on-attack-declared' },
          effect: {
            kind: 'damage',
            amount: 1,
            target: 'opponent-capital',
          },
        },
        // Non-reaction card — used for `not_a_reaction` test.
        {
          kind: 'action',
          id: 'byz-act-foo' as CardId,
          name: 'Foo Action',
          civ: 'byzantines',
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

const cid = (s: string): CardId => s as CardId;

const playReaction = (cardId: CardId, triggerLogIndex = 0): Action =>
  ({ type: 'PlayReaction', cardId, triggerLogIndex }) as unknown as Action;

// Build a state with the reactor (SEAT_2) holding `hand`, optional
// resources, and an open reaction window on the given trigger kind.
function reactorState(
  hand: ReadonlyArray<CardId>,
  resources: Player['resources'] = [],
  triggerKind: 'on-attack-declared' | 'on-damage-dealt' = 'on-attack-declared',
  eligibleSeat: Seat = SEAT_2,
): GameState {
  const reactor = baseState.players[SEAT_2];
  if (reactor === undefined) throw new Error('fixture invariant');
  const newReactor: Player = {
    ...reactor,
    hand: [...hand],
    deck: [cid('byz-deck-1'), cid('byz-deck-2')],
    discard: [],
    resources: [...resources],
  };
  return {
    ...baseState,
    players: { ...baseState.players, [SEAT_2]: newReactor },
    pendingReactionWindow: {
      trigger: { kind: triggerKind },
      triggerContext: {},
      eligibleSeat,
    },
  };
}

describe('PlayReaction — issue #101', () => {
  it('happy path: pays cost, hand→discard, dispatches draw, closes window', () => {
    const before = reactorState(
      [cid('reac-on-attack-draw')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
    );

    const result = applyAction(before, playReaction(cid('reac-on-attack-draw')), SEAT_2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Window closed.
    expect(result.value.pendingReactionWindow).toBeUndefined();
    const after = result.value.players[SEAT_2];
    expect(after).toBeDefined();
    if (after === undefined) return;
    // Card moved hand → discard.
    expect(after.hand).not.toContain(cid('reac-on-attack-draw'));
    expect(after.discard).toContain(cid('reac-on-attack-draw'));
    // Cost exhausted.
    expect(after.resources[0]?.exhausted).toBe(true);
    // Effect dispatched: 1 card drawn.
    expect(after.hand).toEqual([cid('byz-deck-1')]);
  });

  it('no_window_open: state has no pendingReactionWindow → err', () => {
    // Hand-built state with no window. Reactor is SEAT_2.
    const reactor = baseState.players[SEAT_2];
    if (reactor === undefined) throw new Error('fixture invariant');
    const before: GameState = {
      ...baseState,
      players: {
        ...baseState.players,
        [SEAT_2]: { ...reactor, hand: [cid('reac-on-attack-draw')] },
      },
    };

    const result = applyAction(before, playReaction(cid('reac-on-attack-draw')), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no_window_open');
  });

  it('not_eligible_seat: window eligible seat is SEAT_1, SEAT_2 attempts → err', () => {
    // Window's eligibleSeat = SEAT_1. But the seat-gate in applyAction
    // requires reactions from the NON-active seat (active is SEAT_1).
    // So the actor here is SEAT_2 (passes the seat gate) but isn't the
    // eligibleSeat — that's the path we want to exercise.
    const before = reactorState(
      [cid('reac-on-attack-draw')],
      [],
      'on-attack-declared',
      SEAT_1, // <-- window targets SEAT_1
    );

    const result = applyAction(before, playReaction(cid('reac-on-attack-draw')), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_eligible_seat');
  });

  it('card_not_in_hand: reactor does not hold the card → err', () => {
    const before = reactorState([cid('some-other-card')]);
    const result = applyAction(before, playReaction(cid('reac-on-attack-draw')), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_hand');
  });

  it('not_a_reaction: action card played via PlayReaction → err', () => {
    const before = reactorState([cid('byz-act-foo')]);
    const result = applyAction(before, playReaction(cid('byz-act-foo')), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_a_reaction');
  });

  it('trigger_mismatch: reaction trigger kind disagrees with window → err', () => {
    // Window is on-attack-declared. reac-on-damage-draw triggers on
    // on-damage-dealt. Discriminator mismatch → trigger_mismatch.
    const before = reactorState(
      [cid('reac-on-damage-draw')],
      [],
      'on-attack-declared',
    );

    const result = applyAction(before, playReaction(cid('reac-on-damage-draw')), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('trigger_mismatch');
  });

  it('atomic rollback: dispatch err → caller sees unchanged state (cost not paid, card still in hand, window still open)', () => {
    const before = reactorState(
      [cid('reac-damage-bomb')],
      [{ id: 'rt-w-1' as Player['resources'][number]['id'], kind: 'wild', exhausted: false }],
    );
    const snapshot = JSON.parse(JSON.stringify(before));

    const result = applyAction(before, playReaction(cid('reac-damage-bomb')), SEAT_2);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_implemented');
    // Pre-state deep-equal post-state: rollback works. Cost untouched,
    // card still in hand, window still open.
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('insufficient_resources: cost cannot be paid → original state preserved', () => {
    // reac-on-attack-draw costs { wild: 1 }; no resources at all here.
    const before = reactorState([cid('reac-on-attack-draw')]);
    const snapshot = JSON.parse(JSON.stringify(before));

    const result = applyAction(before, playReaction(cid('reac-on-attack-draw')), SEAT_2);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_resources');
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('not_your_turn: active seat attempts to play a reaction → err (seat gate)', () => {
    // SEAT_1 is activePlayer. Reactions must be played by the non-
    // active seat (handled by isOpponentTurnAction gate upstream).
    const before = reactorState([cid('reac-on-attack-draw')]);
    const result = applyAction(before, playReaction(cid('reac-on-attack-draw')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });
});
