import type { CardId, GameState, Player, Tile, UnitInstance } from '@eoe/schema';
import { describe, expect, it } from 'vitest';

import { applyAction } from '../applyAction.js';
import { baseState, SEAT_1, SEAT_2 } from './fixtures.js';

const cid = (s: string): CardId => s as CardId;

function buildCampState(): GameState {
  const seat1 = baseState.players[1];
  const seat2 = baseState.players[2];
  if (seat1 === undefined || seat2 === undefined) {
    throw new Error('baseState must seat players 1 and 2');
  }

  const villageTile: Tile = {
    ...baseState.map.tiles[0]!,
    squares: [
      { coord: { x: 0, y: 0 }, terrain: 'plain' },
      { coord: { x: 1, y: 0 }, terrain: 'forest' },
      { coord: { x: 0, y: 1 }, terrain: 'farmland' },
      { coord: { x: 1, y: 1 }, terrain: 'village' },
    ],
  };
  const player1: Player = { ...seat1, hand: [cid('eng-watchman')], resources: [] };
  const builder: UnitInstance = {
    id: 'unit-builder-1' as UnitInstance['id'],
    cardId: cid('eng-watchman'),
    owner: 1,
    square: { x: 1, y: 1 },
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
    map: { tiles: [villageTile, ...baseState.map.tiles.slice(1)] },
  };
}

describe('BuildCamp', () => {
  it('builds a camp on the builder square, grants 1 token, and exhausts the builder', () => {
    const state = buildCampState();

    const result = applyAction(
      state,
      {
        type: 'BuildCamp',
        builderUnitId: state.units[0]!.id,
        square: { x: 1, y: 1 },
        terrain: 'village',
      },
      SEAT_1,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.version).toBe(state.version + 1);
    expect(result.value.buildings).toHaveLength(state.buildings.length + 1);
    expect(result.value.buildings.at(-1)).toMatchObject({
      type: 'camp',
      owner: 1,
      square: { x: 1, y: 1 },
      terrain: 'village',
      damage: 0,
    });
    expect(result.value.players[1]?.resources).toEqual([
      {
        id: `resource-camp-1-1-0`,
        kind: 'wild',
        exhausted: false,
        sourceCampId: 'camp-1-1-0',
      },
    ]);
    expect(result.value.units[0]?.exhausted).toBe(true);
  });

  it('rejects non-resource terrain squares', () => {
    const state = {
      ...buildCampState(),
      units: [{ ...buildCampState().units[0]!, square: { x: 0, y: 0 } }],
    };

    const result = applyAction(
      state,
      {
        type: 'BuildCamp',
        builderUnitId: state.units[0]!.id,
        square: { x: 0, y: 0 },
        terrain: 'plain',
      },
      SEAT_1,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_build_square');
    }
  });

  it('supports the build → deploy → start-of-turn regeneration loop', () => {
    const state = buildCampState();

    const built = applyAction(
      state,
      {
        type: 'BuildCamp',
        builderUnitId: state.units[0]!.id,
        square: { x: 1, y: 1 },
        terrain: 'village',
      },
      SEAT_1,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const toDeployment = applyAction(built.value, { type: 'EndPhase' }, SEAT_1);
    expect(toDeployment.ok).toBe(true);
    if (!toDeployment.ok) return;

    const deployed = applyAction(
      toDeployment.value,
      {
        type: 'DeployUnit',
        cardId: cid('eng-watchman'),
        square: { x: 0, y: 0 },
      },
      SEAT_1,
    );
    expect(deployed.ok).toBe(true);
    if (!deployed.ok) return;
    expect(deployed.value.players[1]?.resources[0]?.exhausted).toBe(true);

    const toEnd = applyAction(deployed.value, { type: 'EndPhase' }, SEAT_1);
    expect(toEnd.ok).toBe(true);
    if (!toEnd.ok) return;

    const seat2Start = applyAction(toEnd.value, { type: 'EndTurn' }, SEAT_1);
    expect(seat2Start.ok).toBe(true);
    if (!seat2Start.ok) return;

    const seat2Mob = applyAction(seat2Start.value, { type: 'EndPhase' }, SEAT_2);
    expect(seat2Mob.ok).toBe(true);
    if (!seat2Mob.ok) return;
    const seat2Dep = applyAction(seat2Mob.value, { type: 'EndPhase' }, SEAT_2);
    expect(seat2Dep.ok).toBe(true);
    if (!seat2Dep.ok) return;
    const seat2End = applyAction(seat2Dep.value, { type: 'EndPhase' }, SEAT_2);
    expect(seat2End.ok).toBe(true);
    if (!seat2End.ok) return;

    const seat1Start = applyAction(seat2End.value, { type: 'EndTurn' }, SEAT_2);
    expect(seat1Start.ok).toBe(true);
    if (!seat1Start.ok) return;

    const campTokens =
      seat1Start.value.players[1]?.resources.filter(
        (resource) => resource.sourceCampId === 'camp-1-1-0',
      ) ?? [];
    expect(campTokens).toHaveLength(1);
    expect(campTokens[0]?.kind).toBe('wild');
    expect(campTokens[0]?.exhausted).toBe(false);
  });
});
