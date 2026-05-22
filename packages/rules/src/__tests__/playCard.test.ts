import type { Action, CardId, GameState, Player, Seat } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

// ─────────────────────────── playCard tests ──────────────────────────
//
// Issue #36 — PlayCard with the MVP-2 "draw 1" effect.
//
// Pins:
//   • Happy path: card moves hand → discard; top of deck enters hand.
//   • wrong_phase: rejected outside mobilization/deployment.
//   • not_your_turn: rejected when the actor isn't the active seat.
//   • card_not_in_hand: rejected when the named card isn't held.
//   • Empty deck: PlayCard still succeeds (no reshuffle); card moves
//     hand → discard with no draw. Pinned interpretation — note in
//     decision doc.
//   • Input is never mutated; result is a fresh structure.
//   • `state.version` is left to the Worker (handler does not bump it).

const cid = (s: string): CardId => s as CardId;

function withPlayer(
  state: GameState,
  seat: Seat,
  patch: Partial<Player>,
): GameState {
  const player = state.players[seat];
  if (player === undefined) {
    throw new Error(`fixture has no player at seat ${seat}`);
  }
  return {
    ...state,
    players: { ...state.players, [seat]: { ...player, ...patch } },
  };
}

function playCardAction(cardId: CardId): Action {
  return { type: 'PlayCard', cardId } as unknown as Action;
}

describe('PlayCard — happy path (draw 1)', () => {
  it('discards the played card and draws the top of deck during mobilization', () => {
    const seat1Hand = [cid('eng-tactic-rally'), cid('eng-unit-archer')];
    const seat1Deck = [cid('eng-top'), cid('eng-mid'), cid('eng-bot')];
    const state = withPlayer(
      withPlayer(baseState, SEAT_1, {
        hand: seat1Hand,
        deck: seat1Deck,
        discard: [],
      }),
      SEAT_1,
      // re-spread phase via the top-level state below
      {},
    );
    const playing: GameState = { ...state, phase: 'mobilization' };

    const result = applyAction(
      playing,
      playCardAction(cid('eng-tactic-rally')),
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.value.players[1];
    expect(p).toBeDefined();
    if (p === undefined) return;
    // Hand: rally consumed, then top of deck appended.
    expect(p.hand).toEqual([cid('eng-unit-archer'), cid('eng-top')]);
    // Discard: rally appended.
    expect(p.discard).toEqual([cid('eng-tactic-rally')]);
    // Deck: top popped.
    expect(p.deck).toEqual([cid('eng-mid'), cid('eng-bot')]);
  });

  it('also legal during deployment phase', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, {
        hand: [cid('c1')],
        deck: [cid('top')],
      }),
      phase: 'deployment',
    };
    const result = applyAction(state, playCardAction(cid('c1')), SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.players[1]?.hand).toEqual([cid('top')]);
      expect(result.value.players[1]?.discard).toEqual([cid('c1')]);
    }
  });

  it('removes only the FIRST occurrence when the hand has duplicates', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, {
        hand: [cid('dup'), cid('other'), cid('dup')],
        deck: [],
      }),
      phase: 'mobilization',
    };
    const result = applyAction(state, playCardAction(cid('dup')), SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // First copy consumed, second copy still in hand. No deck → no draw.
      expect(result.value.players[1]?.hand).toEqual([cid('other'), cid('dup')]);
      expect(result.value.players[1]?.discard).toEqual([cid('dup')]);
    }
  });
});

describe('PlayCard — rejections', () => {
  it('wrong_phase during start', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, { hand: [cid('c1')], deck: [] }),
      phase: 'start',
    };
    const result = applyAction(state, playCardAction(cid('c1')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('wrong_phase during end', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, { hand: [cid('c1')], deck: [] }),
      phase: 'end',
    };
    const result = applyAction(state, playCardAction(cid('c1')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('not_your_turn when actor is not the active seat', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_2, { hand: [cid('c1')], deck: [] }),
      phase: 'mobilization',
      activePlayer: 1,
    };
    const result = applyAction(state, playCardAction(cid('c1')), SEAT_2);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });

  it('card_not_in_hand when the cardId is absent', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, {
        hand: [cid('other')],
        deck: [cid('top')],
      }),
      phase: 'mobilization',
    };
    const result = applyAction(state, playCardAction(cid('missing')), SEAT_1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('card_not_in_hand');
  });
});

describe('PlayCard — empty deck (no reshuffle)', () => {
  it('succeeds and does not draw when the deck is empty', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, {
        hand: [cid('only')],
        deck: [],
        discard: [cid('older')],
      }),
      phase: 'mobilization',
    };
    const result = applyAction(state, playCardAction(cid('only')), SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const p = result.value.players[1];
      expect(p?.hand).toEqual([]);
      expect(p?.discard).toEqual([cid('older'), cid('only')]);
      expect(p?.deck).toEqual([]);
    }
  });
});

describe('PlayCard — invariants', () => {
  it('does not mutate the input state', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, {
        hand: [cid('c1')],
        deck: [cid('top')],
      }),
      phase: 'mobilization',
    };
    const snapshot = JSON.stringify(state);
    applyAction(state, playCardAction(cid('c1')), SEAT_1);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('leaves state.version untouched (Worker bumps it)', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, {
        hand: [cid('c1')],
        deck: [cid('top')],
      }),
      phase: 'mobilization',
      version: 42,
    };
    const result = applyAction(state, playCardAction(cid('c1')), SEAT_1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.version).toBe(42);
  });

  it('is deterministic: same inputs produce byte-equal outputs', () => {
    const state: GameState = {
      ...withPlayer(baseState, SEAT_1, {
        hand: [cid('a'), cid('b')],
        deck: [cid('t1'), cid('t2'), cid('t3')],
      }),
      phase: 'mobilization',
    };
    const r1 = applyAction(state, playCardAction(cid('a')), SEAT_1);
    const r2 = applyAction(state, playCardAction(cid('a')), SEAT_1);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(JSON.stringify(r1.value)).toBe(JSON.stringify(r2.value));
    }
  });
});
