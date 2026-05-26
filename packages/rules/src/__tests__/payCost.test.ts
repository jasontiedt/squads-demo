import {
  type CardCost,
  type GameState,
  type Player,
  type ResourceToken,
  type ResourceTokenId,
  type TemporaryResource,
  type TemporaryResourceId,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { payCost } from '../payCost.js';
import { baseState, SEAT_1 } from './fixtures.js';

// ─────────────────────────── payCost (Issue #84) ─────────────────────
//
// Six acceptance cases from the issue, plus the deep-equal pin on the
// insufficient path. All states are built fresh from `baseState` —
// the shared fixture is never mutated.

const rtid = (s: string): ResourceTokenId => s as ResourceTokenId;
const trid = (s: string): TemporaryResourceId => s as TemporaryResourceId;

const rtok = (
  id: string,
  kind: ResourceToken['kind'],
  exhausted = false,
): ResourceToken => ({
  id: rtid(id),
  kind,
  exhausted,
});

const ttok = (
  id: string,
  kind: TemporaryResource['kind'],
  current: number,
): TemporaryResource => ({
  id: trid(id),
  kind,
  attachedToCardId: 'src-card-x',
  current,
});

function stateWith(
  resources: ReadonlyArray<ResourceToken>,
  temp: ReadonlyArray<TemporaryResource> = [],
): GameState {
  const p = baseState.players[SEAT_1];
  if (p === undefined) {
    throw new Error('fixture invariant: baseState seats player 1');
  }
  const newPlayer: Player = {
    ...p,
    resources: [...resources],
    temporaryResources: [...temp],
  };
  return {
    ...baseState,
    players: { ...baseState.players, [SEAT_1]: newPlayer },
  };
}

const cost = (c: Record<string, number>): CardCost => c as CardCost;

describe('payCost', () => {
  it('exact match: cost {food:2} with 3 unexhausted food → exhausts 2, leaves 1', () => {
    const before = stateWith([
      rtok('rt-f-1', 'food'),
      rtok('rt-f-2', 'food'),
      rtok('rt-f-3', 'food'),
    ]);

    const result = payCost(before, SEAT_1, cost({ food: 2 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.value.players[SEAT_1];
    expect(after).toBeDefined();
    const exhausted = after!.resources.map((r) => r.exhausted);
    // First two food tokens exhaust; the third stays available.
    expect(exhausted).toEqual([true, true, false]);
  });

  it('wild fallback: cost {food:1} with 0 food + 2 wild → exhausts 1 wild', () => {
    const before = stateWith([
      rtok('rt-w-1', 'wild'),
      rtok('rt-w-2', 'wild'),
    ]);

    const result = payCost(before, SEAT_1, cost({ food: 1 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.value.players[SEAT_1]!;
    expect(after.resources.map((r) => r.exhausted)).toEqual([true, false]);
    // Kinds are still wild — we exhaust, never relabel.
    expect(after.resources.map((r) => r.kind)).toEqual(['wild', 'wild']);
  });

  it('temporary-first: 1 temp food + 2 permanent food, cost {food:2} → temp removed, 1 perm exhausted', () => {
    const before = stateWith(
      [rtok('rt-f-1', 'food'), rtok('rt-f-2', 'food')],
      [ttok('tt-f-1', 'food', 1)],
    );

    const result = payCost(before, SEAT_1, cost({ food: 2 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.value.players[SEAT_1]!;
    // Temp had current=1 and was consumed → dropped from the array.
    expect(after.temporaryResources).toEqual([]);
    // Exactly one of the two permanent tokens is now exhausted.
    expect(after.resources.map((r) => r.exhausted)).toEqual([true, false]);
  });

  it('insufficient: cost {food:5} with 2 food → err, state unchanged (deep-equal pre/post)', () => {
    const before = stateWith([
      rtok('rt-f-1', 'food'),
      rtok('rt-f-2', 'food'),
    ]);
    const snapshot = JSON.parse(JSON.stringify(before));

    const result = payCost(before, SEAT_1, cost({ food: 5 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('insufficient_resources');
    // Original state object must be untouched.
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot);
  });

  it('empty cost {} → no-op, returns state unchanged (same reference)', () => {
    const before = stateWith([rtok('rt-f-1', 'food')]);

    const result = payCost(before, SEAT_1, cost({}));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Empty-cost path is a pure short-circuit: same object identity.
    expect(result.value).toBe(before);
  });

  it('mixed cost: {food:1, wood:1} with 1 unexhausted of each → both exhausted', () => {
    const before = stateWith([
      rtok('rt-f-1', 'food'),
      rtok('rt-w-1', 'wood'),
    ]);

    const result = payCost(before, SEAT_1, cost({ food: 1, wood: 1 }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.value.players[SEAT_1]!;
    expect(after.resources.map((r) => r.exhausted)).toEqual([true, true]);
  });
});
