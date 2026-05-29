import type { CardId, GameState, Player, ResourceTokenId, UnitInstance } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

const cid = (s: string): CardId => s as CardId;
const rtid = (s: string): ResourceTokenId => s as ResourceTokenId;

function buildBarracksState(): GameState {
  const seat1 = baseState.players[1];
  const seat2 = baseState.players[2];
  if (seat1 === undefined || seat2 === undefined) {
    throw new Error('baseState must seat players 1 and 2');
  }

  const player1: Player = {
    ...seat1,
    hand: [cid('eng-watchman')],
    resources: [{ id: rtid('rt-barracks-1'), kind: 'wild', exhausted: false }],
  };
  const builder: UnitInstance = {
    id: 'unit-builder-1' as UnitInstance['id'],
    cardId: cid('eng-watchman'),
    owner: 1,
    square: { x: 0, y: 0 },
    exhausted: false,
    damage: 0,
    attackMode: 'melee',
    upgrades: [],
  };

  return {
    ...baseState,
    phase: 'mobilization',
    activePlayer: 1,
    turn: 1,
    players: { ...baseState.players, 1: player1, 2: seat2 },
    units: [builder],
  };
}

describe('BuildBarracks', () => {
  it('builds on a legal capital-adjacent square, exhausts the cost token, and exhausts the builder', () => {
    const state = buildBarracksState();

    const result = applyAction(
      state,
      {
        type: 'BuildBarracks',
        builderUnitId: state.units[0]!.id,
        square: { x: 1, y: 1 },
      },
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.version).toBe(state.version + 1);
    expect(result.value.buildings.at(-1)).toMatchObject({
      type: 'barracks',
      owner: 1,
      square: { x: 1, y: 1 },
      damage: 0,
    });
    expect(result.value.players[1]?.resources).toEqual([
      { id: 'rt-barracks-1', kind: 'wild', exhausted: true },
    ]);
    expect(result.value.units[0]?.exhausted).toBe(true);
  });

  it('rejects squares that are neither controlled nor adjacent to the actor capital', () => {
    const state = buildBarracksState();

    const result = applyAction(
      state,
      {
        type: 'BuildBarracks',
        builderUnitId: state.units[0]!.id,
        square: { x: 5, y: 4 },
      },
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_build_square');
  });

  it('rejects when the actor cannot pay the build cost', () => {
    const base = buildBarracksState();
    const state: GameState = {
      ...base,
      players: {
        ...base.players,
        1: {
          ...base.players[1]!,
          resources: [],
        },
      },
    };

    const result = applyAction(
      state,
      {
        type: 'BuildBarracks',
        builderUnitId: state.units[0]!.id,
        square: { x: 1, y: 1 },
      },
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('insufficient_resources');
  });

  it('wrong phase: rejects outside mobilization', () => {
    const state: GameState = { ...buildBarracksState(), phase: 'deployment' };

    const result = applyAction(
      state,
      {
        type: 'BuildBarracks',
        builderUnitId: state.units[0]!.id,
        square: { x: 1, y: 1 },
      },
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('wrong_phase');
  });

  it('wrong seat: rejects when actor is not the active player', () => {
    const state = buildBarracksState();

    const result = applyAction(
      state,
      {
        type: 'BuildBarracks',
        builderUnitId: state.units[0]!.id,
        square: { x: 1, y: 1 },
      },
      SEAT_2,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_your_turn');
  });
});
