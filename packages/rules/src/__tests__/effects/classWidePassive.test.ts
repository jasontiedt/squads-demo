import type { CardId, Effect, GameState } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { dispatchEffect, type EffectContext } from '../../effects/dispatch.js';
import { baseState, SEAT_1, SEAT_2 } from '../fixtures.js';

// ─────────────────────────── class-wide-passive (Issue #98) ──────────
//
// Covers: happy path (registration pushed onto state.classWidePassives
// with the actor seat recorded; modifier shape preserved), accumulation
// across multiple fires, ownership flavors (own/opponent/all), and
// determinism (no input-state mutation, append-only).

const cid = (s: string): CardId => s as CardId;
const ctx1: EffectContext = { actorSeat: SEAT_1, cardId: cid('eng-tech-iron') };
const ctx2: EffectContext = { actorSeat: SEAT_2, cardId: cid('byz-tech-bow') };

describe('class-wide-passive effect', () => {
  it('registers a stat-delta modifier with the actor seat', () => {
    const effect: Extract<Effect, { kind: 'class-wide-passive' }> = {
      kind: 'class-wide-passive',
      classFilter: 'infantry',
      ownership: 'own',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
    };

    const r = dispatchEffect(baseState, effect, ctx1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.value.classWidePassives).toEqual([
      {
        seat: SEAT_1,
        classFilter: 'infantry',
        ownership: 'own',
        modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
      },
    ]);
  });

  it('registers a keyword modifier', () => {
    const r = dispatchEffect(
      baseState,
      {
        kind: 'class-wide-passive',
        classFilter: 'cavalry',
        ownership: 'all',
        modifier: { kind: 'keyword', keyword: 'charge' },
      },
      ctx1,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.classWidePassives?.[0]?.modifier).toEqual({
      kind: 'keyword',
      keyword: 'charge',
    });
  });

  it('accumulates registrations across multiple fires (append-only)', () => {
    const e1: Extract<Effect, { kind: 'class-wide-passive' }> = {
      kind: 'class-wide-passive',
      classFilter: 'infantry',
      ownership: 'own',
      modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
    };
    const e2: Extract<Effect, { kind: 'class-wide-passive' }> = {
      kind: 'class-wide-passive',
      classFilter: 'archers',
      ownership: 'opponent',
      modifier: { kind: 'stat-delta', stat: 'ranged', delta: -1 },
    };

    const r1 = dispatchEffect(baseState, e1, ctx1);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = dispatchEffect(r1.value, e2, ctx2);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;

    expect(r2.value.classWidePassives).toHaveLength(2);
    expect(r2.value.classWidePassives?.[0]?.seat).toBe(SEAT_1);
    expect(r2.value.classWidePassives?.[1]?.seat).toBe(SEAT_2);
    expect(r2.value.classWidePassives?.[1]?.ownership).toBe('opponent');
  });

  it('preserves an existing classWidePassives array (does not overwrite)', () => {
    const seeded: GameState = {
      ...baseState,
      classWidePassives: [
        {
          seat: SEAT_2,
          classFilter: 'naval',
          ownership: 'own',
          modifier: { kind: 'keyword', keyword: 'amphibious' },
        },
      ],
    };
    const r = dispatchEffect(
      seeded,
      {
        kind: 'class-wide-passive',
        classFilter: 'infantry',
        ownership: 'own',
        modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
      },
      ctx1,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.classWidePassives).toHaveLength(2);
    expect(r.value.classWidePassives?.[0]?.classFilter).toBe('naval');
    expect(r.value.classWidePassives?.[1]?.classFilter).toBe('infantry');
  });

  it('does not mutate the input state', () => {
    const before = JSON.stringify(baseState);
    dispatchEffect(
      baseState,
      {
        kind: 'class-wide-passive',
        classFilter: 'infantry',
        ownership: 'own',
        modifier: { kind: 'stat-delta', stat: 'melee', delta: 1 },
      },
      ctx1,
    );
    expect(JSON.stringify(baseState)).toBe(before);
    expect(baseState.classWidePassives).toBeUndefined();
  });
});
