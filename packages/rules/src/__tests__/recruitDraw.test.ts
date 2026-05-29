import type { Action, CardId, GameState, Player, Seat } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

const cid = (s: string): CardId => s as CardId;

function withPlayer(
  state: GameState,
  seat: Seat,
  patch: Partial<Player>,
): GameState {
  const player = state.players[seat];
  if (player === undefined) return state;
  return {
    ...state,
    players: {
      ...state.players,
      [seat]: { ...player, ...patch },
    },
  };
}

function recruitDraw(count: number): Action {
  return {
    type: 'RecruitDraw',
    payload: { count },
  } as unknown as Action;
}

function recruitState(playerPatch: Partial<Player>): GameState {
  return withPlayer(
    {
      ...baseState,
      phase: 'mobilization',
      activePlayer: SEAT_1,
    },
    SEAT_1,
    playerPatch,
  );
}

describe('RecruitDraw — MVP-7 S5', () => {
  it('draws N cards from deck top into hand', () => {
    const state = recruitState({
      hand: [cid('h1')],
      deck: [cid('d1'), cid('d2'), cid('d3')],
      discard: [],
    });

    const result = applyAction(state, recruitDraw(2), SEAT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.value.players[SEAT_1];
    expect(after?.hand).toEqual([cid('h1'), cid('d1'), cid('d2')]);
    expect(after?.deck).toEqual([cid('d3')]);
    expect(after?.discard).toEqual([]);
  });

  it('hand-cap overflow discards trailing cards positionally', () => {
    const state = recruitState({
      hand: [cid('h1'), cid('h2'), cid('h3'), cid('h4'), cid('h5'), cid('h6')],
      deck: [cid('d1'), cid('d2'), cid('d3')],
      discard: [cid('x1')],
    });

    const result = applyAction(state, recruitDraw(2), SEAT_1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = result.value.players[SEAT_1];
    expect(after?.hand).toEqual([
      cid('h1'), cid('h2'), cid('h3'), cid('h4'), cid('h5'), cid('h6'), cid('d1'),
    ]);
    expect(after?.discard).toEqual([cid('x1'), cid('d2')]);
  });

  it('empty-deck path rejects with deck_empty (no reshuffle)', () => {
    const state = recruitState({
      hand: [cid('h1')],
      deck: [],
      discard: [cid('disc1')],
    });

    const result = applyAction(state, recruitDraw(1), SEAT_1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('deck_empty');
  });

  it('phase/seat gates via applyAction', () => {
    const state = recruitState({
      hand: [cid('h1')],
      deck: [cid('d1')],
      discard: [],
    });

    const wrongPhase = applyAction({ ...state, phase: 'deployment' }, recruitDraw(1), SEAT_1);
    expect(wrongPhase.ok).toBe(false);
    if (!wrongPhase.ok) expect(wrongPhase.error.code).toBe('wrong_phase');

    const wrongSeat = applyAction(state, recruitDraw(1), SEAT_2);
    expect(wrongSeat.ok).toBe(false);
    if (!wrongSeat.ok) expect(wrongSeat.error.code).toBe('not_your_turn');
  });
});
