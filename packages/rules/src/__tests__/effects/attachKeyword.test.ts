import type {
  CardId,
  Effect,
  GameState,
  Seat,
  UnitInstance,
  UnitInstanceId,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { dispatchEffect, type EffectContext } from '../../effects/dispatch.js';
import { baseState, SEAT_1, SEAT_2 } from '../fixtures.js';

// ─────────────────────────── attach-keyword (Issue #98) ──────────────
//
// Covers: happy path (keyword appended; accumulates with existing
// attachments; non-targeted units untouched), determinism (no mutation
// of input state), and target validation (missing unit id surfaces
// `target_not_found`).

const uid = (s: string): UnitInstanceId => s as UnitInstanceId;
const cid = (s: string): CardId => s as CardId;

function unit(id: string, owner: Seat, square = { x: 0, y: 0 }): UnitInstance {
  return {
    id: uid(id),
    cardId: cid('eng-unit-archer'),
    owner,
    square,
    exhausted: false,
    damage: 0,
    attackMode: 'melee',
    upgrades: [],
  };
}

function withUnits(units: ReadonlyArray<UnitInstance>): GameState {
  return { ...baseState, units: [...units] };
}

const ctx: EffectContext = { actorSeat: SEAT_1, cardId: cid('eng-upg-first-strike') };

describe('attach-keyword effect', () => {
  it('appends a keyword attachment to the targeted unit', () => {
    const u1 = unit('u-1', SEAT_1);
    const state = withUnits([u1]);
    const effect: Extract<Effect, { kind: 'attach-keyword' }> = {
      kind: 'attach-keyword',
      target: { kind: 'unit', unitId: u1.id },
      keyword: 'first-strike',
    };

    const r = dispatchEffect(state, effect, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const updated = r.value.units.find((u) => u.id === u1.id);
    expect(updated?.attachments).toEqual([{ keyword: 'first-strike' }]);
  });

  it('accumulates with existing attachments (no dedupe at schema layer)', () => {
    const u1: UnitInstance = {
      ...unit('u-1', SEAT_1),
      attachments: [{ keyword: 'pierce' }],
    };
    const state = withUnits([u1]);
    const r = dispatchEffect(
      state,
      {
        kind: 'attach-keyword',
        target: { kind: 'unit', unitId: u1.id },
        keyword: 'first-strike',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const updated = r.value.units.find((u) => u.id === u1.id);
    expect(updated?.attachments).toEqual([
      { keyword: 'pierce' },
      { keyword: 'first-strike' },
    ]);
  });

  it('leaves other units untouched', () => {
    const u1 = unit('u-1', SEAT_1);
    const u2 = unit('u-2', SEAT_2);
    const state = withUnits([u1, u2]);
    const r = dispatchEffect(
      state,
      {
        kind: 'attach-keyword',
        target: { kind: 'unit', unitId: u1.id },
        keyword: 'first-strike',
      },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const u2After = r.value.units.find((u) => u.id === u2.id);
    expect(u2After?.attachments).toBeUndefined();
    expect(u2After).toBe(u2);
  });

  it('does not mutate the input state', () => {
    const u1 = unit('u-1', SEAT_1);
    const state = withUnits([u1]);
    const before = JSON.stringify(state);
    dispatchEffect(
      state,
      {
        kind: 'attach-keyword',
        target: { kind: 'unit', unitId: u1.id },
        keyword: 'first-strike',
      },
      ctx,
    );
    expect(JSON.stringify(state)).toBe(before);
    expect(state.units[0]?.attachments).toBeUndefined();
  });

  it('returns target_not_found when the unit id is not on the board', () => {
    const state = withUnits([unit('u-1', SEAT_1)]);
    const r = dispatchEffect(
      state,
      {
        kind: 'attach-keyword',
        target: { kind: 'unit', unitId: uid('u-missing') },
        keyword: 'first-strike',
      },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('target_not_found');
    expect(r.error.message).toContain('u-missing');
  });
});
