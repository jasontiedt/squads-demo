import type { GameState } from '@eoe/schema';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../index.js';

describe('applyAction (stub)', () => {
  it('returns not_implemented until Artoo wires real handlers', () => {
    const fakeState = {} as GameState;
    const result = applyAction(fakeState, { type: 'end_turn' }, 'p1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_implemented');
    }
  });
});
