import type {
  Action,
  CardId,
  GameState,
  Player,
  ResourceToken,
  ResourceTokenId,
  Seat,
  UnitInstanceId,
} from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

const cid = (s: string): CardId => s as CardId;
const rtid = (s: string): ResourceTokenId => s as ResourceTokenId;
const uid = (s: string): UnitInstanceId => s as UnitInstanceId;

const token = (
  id: string,
  kind: ResourceToken['kind'],
  exhausted = false,
): ResourceToken => ({
  id: rtid(id),
  kind,
  exhausted,
});

function resupplyAction(): Action {
  return {
    type: 'Resupply',
    unitId: uid('unit-resupply-1'),
  } as Action;
}

interface ResupplyStateOpts {
  resources?: ReadonlyArray<ResourceToken>;
  deck?: ReadonlyArray<string>;
  discard?: ReadonlyArray<string>;
  phase?: GameState['phase'];
  activePlayer?: Seat;
}

function resupplyState(opts: ResupplyStateOpts = {}): GameState {
  const seat1 = baseState.players[SEAT_1];
  if (seat1 === undefined) {
    throw new Error('baseState must seat player 1 — fixture invariant violated');
  }

  const player: Player = {
    ...seat1,
    resources: [...(opts.resources ?? [])],
    deck: [...(opts.deck ?? ['deck-top'])].map(cid),
    discard: [...(opts.discard ?? [])].map(cid),
  };

  return {
    ...baseState,
    phase: opts.phase ?? 'mobilization',
    activePlayer: opts.activePlayer ?? SEAT_1,
    players: { ...baseState.players, [SEAT_1]: player },
  };
}

describe('Resupply', () => {
  it('refreshes exhausted tokens and discards the top card from the actor deck', () => {
    const state = resupplyState({
      resources: [
        token('rt-food-1', 'food', true),
        token('rt-wood-1', 'wood', true),
        token('rt-gold-1', 'gold', false),
      ],
      deck: ['top-card', 'next-card'],
      discard: ['already-discarded'],
    });

    const result = applyAction(state, resupplyAction(), SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const player = result.value.players[SEAT_1];
    expect(player).toBeDefined();
    if (player === undefined) return;

    expect(player.resources.map((resource) => resource.exhausted)).toEqual([
      false,
      false,
      false,
    ]);
    expect(player.deck).toEqual([cid('next-card')]);
    expect(player.discard).toEqual([cid('already-discarded'), cid('top-card')]);
  });

  it('leaves already-unexhausted tokens untouched', () => {
    const state = resupplyState({
      resources: [token('rt-food-1', 'food', false), token('rt-wild-1', 'wild', false)],
      deck: ['top-card'],
    });

    const result = applyAction(state, resupplyAction(), SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const player = result.value.players[SEAT_1];
    expect(player).toBeDefined();
    if (player === undefined) return;

    expect(player.resources).toEqual(state.players[SEAT_1]?.resources);
  });

  it('returns deck_too_thin when the actor deck has fewer cards than the discard cost', () => {
    const state = resupplyState({
      resources: [token('rt-food-1', 'food', true)],
      deck: [],
    });
    const snapshot = JSON.stringify(state);

    const result = applyAction(state, resupplyAction(), SEAT_1);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('deck_too_thin');
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('obeys the phase gate', () => {
    const state = resupplyState({ phase: 'deployment' });

    const result = applyAction(state, resupplyAction(), SEAT_1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('wrong_phase');
    }
  });

  it('obeys the active-seat gate', () => {
    const state = resupplyState({ activePlayer: SEAT_1 });

    const result = applyAction(state, resupplyAction(), SEAT_2);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_your_turn');
    }
  });

  // @needs-confirmation: Does Resupply always discard exactly 1 card, or
  // can the cost vary by civ/effect once the OCR is confirmed?
  // Default: discard exactly the top 1 card from the actor deck.
  // This stays skipped on purpose even though the live suite currently
  // relies on the same default: it is the explicit confirmation pin to
  // unskip once the OCR-backed rule is settled.
  it.skip('pins the current MVP default that Resupply costs N=1 discarded card', () => {
    const state = resupplyState({
      resources: [token('rt-food-1', 'food', false)],
      deck: ['cost-card', 'still-on-deck'],
    });

    const result = applyAction(state, resupplyAction(), SEAT_1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.players[SEAT_1]?.deck).toEqual([cid('still-on-deck')]);
    expect(result.value.players[SEAT_1]?.discard).toEqual([cid('cost-card')]);
  });
});
