import { describe, expect, it } from 'vitest';
import { GameState } from '@eoe/schema';
import { initialState } from './fixtures/initial-state.js';

describe('initial-state fixture', () => {
  it('parses cleanly through GameState schema', () => {
    expect(() => GameState.parse(initialState)).not.toThrow();
  });

  it('has both players and capitals at opposite corners', () => {
    expect(initialState.players[1]?.capitalSquare).toEqual({ x: 0, y: 0 });
    expect(initialState.players[2]?.capitalSquare).toEqual({ x: 5, y: 5 });
    expect(initialState.buildings.filter((b) => b.type === 'capital')).toHaveLength(2);
  });

  it('seat 2 has the first-player wild slot', () => {
    expect(initialState.players[2]?.firstPlayerSecondPlayerWild).toBe(true);
    expect(initialState.players[1]?.firstPlayerSecondPlayerWild).toBeUndefined();
  });
});
