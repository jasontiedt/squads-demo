import type { ActiveEvent, CardId, GameState, Player } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { eventTick } from '../eventTick.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

const cid = (s: string): CardId => s as CardId;

const evt = (id: string, ticksRemaining: number): ActiveEvent => ({
  cardId: cid(id),
  ticksRemaining,
  effect: { kind: 'draw', count: 1 },
});

function withEvents(
  seat: typeof SEAT_1 | typeof SEAT_2,
  activeEvents: ReadonlyArray<ActiveEvent>,
  discard: ReadonlyArray<CardId> = [],
): GameState {
  const p = baseState.players[seat];
  if (p === undefined) throw new Error('fixture invariant');
  const newPlayer: Player = {
    ...p,
    activeEvents: [...activeEvents],
    discard: [...discard],
  };
  return {
    ...baseState,
    players: { ...baseState.players, [seat]: newPlayer },
  };
}

describe('eventTick — issue #100 (MVP-6 S4)', () => {
  it('decrements ticksRemaining on every active event for the given seat', () => {
    const before = withEvents(SEAT_1, [evt('e1', 3), evt('e2', 2)]);
    const after = eventTick(before, SEAT_1);
    const p = after.players[SEAT_1];
    expect(p).toBeDefined();
    if (p === undefined) return;
    expect(p.activeEvents).toEqual([
      { cardId: cid('e1'), ticksRemaining: 2, effect: { kind: 'draw', count: 1 } },
      { cardId: cid('e2'), ticksRemaining: 1, effect: { kind: 'draw', count: 1 } },
    ]);
    // Nothing expired yet — discard untouched.
    expect(p.discard).toEqual([]);
  });

  it('removes expired events (counter → 0) and moves cardIds to discard', () => {
    const before = withEvents(SEAT_1, [evt('e1', 1), evt('e2', 2)]);
    const after = eventTick(before, SEAT_1);
    const p = after.players[SEAT_1];
    expect(p).toBeDefined();
    if (p === undefined) return;
    // e1 expired (1 → 0), e2 stays (2 → 1).
    expect(p.activeEvents).toEqual([
      { cardId: cid('e2'), ticksRemaining: 1, effect: { kind: 'draw', count: 1 } },
    ]);
    expect(p.discard).toEqual([cid('e1')]);
  });

  it('handles multiple simultaneous expirations in original order', () => {
    const before = withEvents(SEAT_1, [evt('a', 1), evt('b', 1), evt('c', 3)]);
    const after = eventTick(before, SEAT_1);
    const p = after.players[SEAT_1];
    if (p === undefined) throw new Error('seat missing');
    expect(p.activeEvents).toEqual([
      { cardId: cid('c'), ticksRemaining: 2, effect: { kind: 'draw', count: 1 } },
    ]);
    expect(p.discard).toEqual([cid('a'), cid('b')]);
  });

  it('appends expired cardIds to pre-existing discard (does not replace)', () => {
    const before = withEvents(SEAT_1, [evt('x', 1)], [cid('prev-1'), cid('prev-2')]);
    const after = eventTick(before, SEAT_1);
    const p = after.players[SEAT_1];
    if (p === undefined) throw new Error('seat missing');
    expect(p.discard).toEqual([cid('prev-1'), cid('prev-2'), cid('x')]);
  });

  it('no-op when seat has no active events', () => {
    const before = withEvents(SEAT_1, []);
    const after = eventTick(before, SEAT_1);
    // Should return the same reference (early-return optimisation).
    expect(after).toBe(before);
  });

  it('does NOT tick the non-active seat', () => {
    const seat1Events = [evt('s1', 3)];
    const seat2Events = [evt('s2', 3)];
    const p1 = baseState.players[SEAT_1];
    const p2 = baseState.players[SEAT_2];
    if (p1 === undefined || p2 === undefined) throw new Error('fixture invariant');
    const before: GameState = {
      ...baseState,
      players: {
        ...baseState.players,
        [SEAT_1]: { ...p1, activeEvents: seat1Events },
        [SEAT_2]: { ...p2, activeEvents: seat2Events },
      },
    };
    const after = eventTick(before, SEAT_1);
    expect(after.players[SEAT_1]?.activeEvents[0]?.ticksRemaining).toBe(2);
    // Seat 2 untouched.
    expect(after.players[SEAT_2]?.activeEvents[0]?.ticksRemaining).toBe(3);
  });

  it('handles seat with no Player record (defensive — returns state unchanged)', () => {
    const seat1Player = baseState.players[SEAT_1];
    if (seat1Player === undefined) throw new Error('fixture invariant');
    const before: GameState = {
      ...baseState,
      players: { [SEAT_1]: seat1Player },
    };
    const after = eventTick(before, SEAT_2);
    expect(after).toBe(before);
  });
});
