import type { Action, CardId, GameState, Player, Seat } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { drawAndDiscardCleanup, drawCard } from '../draw.js';
import { mulberry32, seedFor } from '../rng.js';
import { baseState, SEAT_1 } from './fixtures.js';

// ─────────────────────────── Test helpers ────────────────────────────

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

const endTurn: Action = { type: 'EndTurn' } as unknown as Action;

// ─────────────────────────── drawCard ────────────────────────────────

describe('drawCard', () => {
  it('decrements deck by one and increments hand by one', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [],
      deck: [cid('c1'), cid('c2'), cid('c3')],
    });
    const r = drawCard(state, SEAT_1);
    expect(r.drawn).toBe('c1');
    expect(r.state.players[1]?.hand).toEqual(['c1']);
    expect(r.state.players[1]?.deck).toEqual(['c2', 'c3']);
  });

  it('returns null and unchanged state when the deck is empty (no reshuffle)', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [cid('h1')],
      deck: [],
      discard: [cid('d1'), cid('d2')], // discard must NOT be reshuffled
    });
    const r = drawCard(state, SEAT_1);
    expect(r.drawn).toBeNull();
    // Same reference — no allocation when there's nothing to do.
    expect(r.state).toBe(state);
    expect(r.state.players[1]?.discard).toEqual(['d1', 'd2']);
  });

  it('does not mutate the input state', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [],
      deck: [cid('c1'), cid('c2')],
    });
    const snapshot = JSON.stringify(state);
    drawCard(state, SEAT_1);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('always draws from the top (front) of the deck — deterministic', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [],
      deck: [cid('top'), cid('middle'), cid('bottom')],
    });
    const r1 = drawCard(state, SEAT_1);
    const r2 = drawCard(state, SEAT_1);
    expect(r1.drawn).toBe('top');
    // Same input → same output (state was not mutated, both draws see the same deck).
    expect(r2.drawn).toBe('top');
  });
});

// ─────────────────────────── drawAndDiscardCleanup (direct) ──────────

describe('drawAndDiscardCleanup (direct)', () => {
  it('fills hand from 2 → 5 when the deck has enough cards', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [cid('h1'), cid('h2')],
      deck: [cid('d1'), cid('d2'), cid('d3'), cid('d4'), cid('d5')],
    });
    const out = drawAndDiscardCleanup(state);
    expect(out.players[1]?.hand).toEqual(['h1', 'h2', 'd1', 'd2', 'd3']);
    expect(out.players[1]?.deck).toEqual(['d4', 'd5']);
  });

  it('+1 draw when hand is already ≥ 5', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [
        cid('h1'), cid('h2'), cid('h3'), cid('h4'), cid('h5'), cid('h6'),
      ],
      deck: [cid('d1'), cid('d2')],
    });
    const out = drawAndDiscardCleanup(state);
    expect(out.players[1]?.hand.length).toBe(7);
    expect(out.players[1]?.hand).toEqual([
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'd1',
    ]);
    expect(out.players[1]?.deck).toEqual(['d2']);
  });

  it('hand cap: when hand > 7 after the draw, discards from the END of the hand', () => {
    // hand=7 (≥5) → draw +1 = 8 → discard 1 to cap at 7.
    const state = withPlayer(baseState, SEAT_1, {
      hand: [
        cid('h1'), cid('h2'), cid('h3'), cid('h4'),
        cid('h5'), cid('h6'), cid('h7'),
      ],
      deck: [cid('drawn')],
      discard: [],
    });
    const out = drawAndDiscardCleanup(state);
    // @needs-confirmation: discard strategy is positional (end-of-hand).
    // After append-then-trim, the *drawn* card lands at index 7 and is
    // the one that goes to the discard pile.
    expect(out.players[1]?.hand).toEqual([
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7',
    ]);
    expect(out.players[1]?.discard).toEqual(['drawn']);
  });

  it('draws fewer than the target when the deck runs out (no reshuffle)', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [cid('h1')],
      deck: [cid('d1'), cid('d2')],
      discard: [cid('disc1'), cid('disc2')], // must NOT be reshuffled in
    });
    const out = drawAndDiscardCleanup(state);
    expect(out.players[1]?.hand).toEqual(['h1', 'd1', 'd2']);
    expect(out.players[1]?.deck).toEqual([]);
    expect(out.players[1]?.discard).toEqual(['disc1', 'disc2']);
  });

  it('hand ≥ 5 with empty deck: hand unchanged, no error', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [cid('h1'), cid('h2'), cid('h3'), cid('h4'), cid('h5')],
      deck: [],
    });
    const out = drawAndDiscardCleanup(state);
    expect(out.players[1]?.hand.length).toBe(5);
    expect(out.players[1]?.deck.length).toBe(0);
  });

  it('does not mutate the input state', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [cid('h1')],
      deck: [cid('d1'), cid('d2'), cid('d3'), cid('d4'), cid('d5')],
    });
    const snapshot = JSON.stringify(state);
    drawAndDiscardCleanup(state);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

// ─────────────────────────── EndTurn integration ─────────────────────

describe('EndTurn integration (cleanup runs on the ending seat)', () => {
  it('refills the ending seat\'s hand to 5 before rotating', () => {
    const state = withPlayer(baseState, SEAT_1, {
      hand: [cid('h1'), cid('h2')],
      deck: [cid('d1'), cid('d2'), cid('d3'), cid('d4'), cid('d5')],
    });
    const ended: GameState = { ...state, phase: 'end' };
    const r = applyAction(ended, endTurn, SEAT_1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Cleanup applied to seat 1 (the seat that just ended).
    expect(r.value.players[1]?.hand.length).toBe(5);
    // Then rotation: seat 2 becomes active.
    expect(r.value.activePlayer).toBe(2);
    // Seat 2's hand is untouched by cleanup.
    expect(r.value.players[2]?.hand.length).toBe(baseState.players[2]?.hand.length);
  });

  it('byte-equal determinism: EndTurn twice on identical clones produces identical results', () => {
    const seed = withPlayer(baseState, SEAT_1, {
      hand: [cid('h1'), cid('h2')],
      deck: [cid('d1'), cid('d2'), cid('d3'), cid('d4')],
    });
    const ended: GameState = { ...seed, phase: 'end' };

    const clone1 = JSON.parse(JSON.stringify(ended)) as GameState;
    const clone2 = JSON.parse(JSON.stringify(ended)) as GameState;

    const r1 = applyAction(clone1, endTurn, SEAT_1);
    const r2 = applyAction(clone2, endTurn, SEAT_1);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    expect(JSON.stringify(r1.value)).toBe(JSON.stringify(r2.value));
  });
});

// ─────────────────────────── Seeded RNG primitive ────────────────────

describe('seeded RNG (mulberry32 + seedFor)', () => {
  it('mulberry32 yields the same stream for the same seed', () => {
    const a = mulberry32(0xdeadbeef);
    const b = mulberry32(0xdeadbeef);
    for (let i = 0; i < 8; i++) {
      expect(a()).toBe(b());
    }
  });

  it('seedFor mixes seed + turn + activePlayer + salt deterministically', () => {
    const stateLike = { seed: 'eoe-test', turn: 3, activePlayer: 2 };
    const s1 = seedFor(stateLike, 'draw');
    const s2 = seedFor(stateLike, 'draw');
    const s3 = seedFor(stateLike, 'shuffle');
    expect(s1).toBe(s2); // same inputs → same uint32
    expect(s1).not.toBe(s3); // different salt → different uint32
  });
});
