import {
  BuildingInstanceId,
  type Action,
  type BuildingInstance,
  type Coord,
  type GameState,
  type Seat,
  type TileId,
} from '@eoe/schema';

import { exhaustForCost } from './exhaustForCost.js';
import { capitalOf, tileOfSquare, unitsOnTile } from './queries.js';
import { err, ok, type Result } from './result.js';

type BuildBarracksAction = Extract<Action, { type: 'BuildBarracks' }>;

const BARRACKS_BUILD_COST = { wild: 1 } as const;

function chebyshevAdjacent(a: Coord, b: Coord): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx > 0 || dy > 0) && (dx > dy ? dx : dy) === 1;
}

function isControlledTile(state: GameState, tileId: TileId, actorId: Seat): boolean {
  if (unitsOnTile(state, tileId).some((unit) => unit.owner === actorId)) return true;
  return state.buildings.some(
    (building) => building.owner === actorId && tileOfSquare(state, building.square) === tileId,
  );
}

function isLegalBarracksSquare(
  state: GameState,
  actorId: Seat,
  square: BuildBarracksAction['square'],
): boolean {
  const tile = state.map.tiles.find((entry) =>
    entry.squares.some(
      (candidate) => candidate.coord.x === square.x && candidate.coord.y === square.y,
    ),
  );
  if (tile === undefined || tile.faceDown) return false;

  const capital = capitalOf(state, actorId);
  if (capital !== undefined && chebyshevAdjacent(capital.square, square)) {
    return true;
  }

  return isControlledTile(state, tile.id, actorId);
}

export function buildBarracks(
  state: GameState,
  action: BuildBarracksAction,
  actorId: Seat,
): Result<GameState> {
  const player = state.players[actorId];
  if (player === undefined) {
    return err(
      'not_your_turn',
      `no player seated at ${actorId} (defensive — upstream gate should catch this)`,
    );
  }

  const builder = state.units.find((unit) => unit.id === action.builderUnitId);
  if (builder === undefined) {
    return err('unit_not_found', `builder unit ${action.builderUnitId} was not found`);
  }
  if (builder.owner !== actorId) {
    return err(
      'unit_not_yours',
      `builder unit ${action.builderUnitId} is owned by seat ${builder.owner}, not seat ${actorId}`,
    );
  }
  if (builder.exhausted) {
    return err(
      'unit_exhausted',
      `builder unit ${action.builderUnitId} is exhausted and cannot build this turn`,
    );
  }
  if (!isLegalBarracksSquare(state, actorId, action.square)) {
    return err(
      'invalid_build_square',
      `Barracks must be built on a face-up controlled tile or a square adjacent to your Capital; got (${action.square.x},${action.square.y})`,
    );
  }

  const occupiedByBuilding = state.buildings.some(
    (building) => building.square.x === action.square.x && building.square.y === action.square.y,
  );
  if (occupiedByBuilding) {
    return err(
      'invalid_build_square',
      `target square (${action.square.x},${action.square.y}) already has a building`,
    );
  }

  const payment = exhaustForCost(player.resources, BARRACKS_BUILD_COST);
  if (!payment.ok) return payment;

  const barracksId = BuildingInstanceId.parse(`barracks-${state.turn}-${actorId}-${state.version}`);
  const barracks: BuildingInstance = {
    id: barracksId,
    type: 'barracks',
    owner: actorId,
    square: { x: action.square.x, y: action.square.y },
    damage: 0,
  };

  return ok({
    ...state,
    version: state.version + 1,
    players: {
      ...state.players,
      [actorId]: {
        ...player,
        resources: payment.value,
      },
    },
    units: state.units.map((unit) =>
      unit.id === builder.id ? { ...unit, exhausted: true } : unit,
    ),
    buildings: [...state.buildings, barracks],
  });
}
