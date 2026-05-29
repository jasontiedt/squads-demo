import type { CardId, Effect } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { CAPITAL_DEFAULT_HP } from '../../constants.js';
import { dispatchEffect, type EffectContext } from '../../effects/dispatch.js';
import { baseState, SEAT_1 } from '../fixtures.js';

const cid = (s: string): CardId => s as CardId;
const ctx: EffectContext = { actorSeat: SEAT_1, cardId: cid('byz-imperial-shield') };

describe('heal-capital effect', () => {
  it('heals the actor seat capital by the requested amount', () => {
    const effect: Extract<Effect, { kind: 'heal-capital' }> = {
      kind: 'heal-capital',
      amount: 2,
      target: 'self',
    };

    const result = dispatchEffect(baseState, effect, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.players[1]?.capitalHp).toBe(baseState.players[1]!.capitalHp + 2);
    expect(result.value.players[2]?.capitalHp).toBe(baseState.players[2]!.capitalHp);
  });

  it('caps healing at the default capital HP ceiling', () => {
    const effect: Extract<Effect, { kind: 'heal-capital' }> = {
      kind: 'heal-capital',
      amount: 5,
      target: 'self',
    };

    const state = {
      ...baseState,
      players: {
        ...baseState.players,
        1: {
          ...baseState.players[1]!,
          capitalHp: CAPITAL_DEFAULT_HP - 1,
        },
      },
    };

    const result = dispatchEffect(state, effect, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.players[1]?.capitalHp).toBe(CAPITAL_DEFAULT_HP);
  });
});
