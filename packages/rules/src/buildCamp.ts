import {
  BuildingInstanceId,
  type Action,
  type BuildingInstance,
  type GameState,
  type ResourceToken,
  type Seat,
  type TerrainType,
} from '@eoe/schema';

import { campTokenId, resourceKindForCampTerrain } from './campResources.js';
import { err, ok, type Result } from './result.js';

type BuildCampAction = Extract<Action, { type: 'BuildCamp' }>;

function terrainAtSquare(
  state: GameState,
  square: BuildCampAction['square'],
): TerrainType | null {
  for (const tile of state.map.tiles) {
    for (const entry of tile.squares) {
      if (entry.coord.x === square.x && entry.coord.y === square.y) {
        return entry.terrain;
      }
    }
  }
  return null;
}

export function buildCamp(
  state: GameState,
  action: BuildCampAction,
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
  if (builder.square.x !== action.square.x || builder.square.y !== action.square.y) {
    return err(
      'invalid_build_square',
      `BuildCamp must target the builder's square (${builder.square.x},${builder.square.y}); got (${action.square.x},${action.square.y})`,
    );
  }

  const actualTerrain = terrainAtSquare(state, action.square);
  if (actualTerrain === null) {
    return err(
      'invalid_build_square',
      `target square (${action.square.x},${action.square.y}) is not on the map`,
    );
  }
  if (actualTerrain !== action.terrain) {
    return err(
      'invalid_build_square',
      `target square (${action.square.x},${action.square.y}) has terrain '${actualTerrain}', not '${action.terrain}'`,
    );
  }

  const resourceKind = resourceKindForCampTerrain(actualTerrain);
  if (resourceKind === null) {
    return err(
      'invalid_build_square',
      `Camps may only be built on resource terrain; '${actualTerrain}' does not produce a token`,
    );
  }

  const occupiedByBuilding = state.buildings.some(
    (building) =>
      building.square.x === action.square.x && building.square.y === action.square.y,
  );
  if (occupiedByBuilding) {
    return err(
      'invalid_build_square',
      `target square (${action.square.x},${action.square.y}) already has a building`,
    );
  }

  const campId = BuildingInstanceId.parse(`camp-${state.turn}-${actorId}-${state.version}`);

  const newCamp: BuildingInstance = {
    id: campId,
    type: 'camp',
    owner: actorId,
    square: { x: action.square.x, y: action.square.y },
    damage: 0,
    terrain: actualTerrain,
  };

  const newToken: ResourceToken = {
    id: campTokenId(campId),
    kind: resourceKind,
    exhausted: false,
    sourceCampId: campId,
  };

  return ok({
    ...state,
    version: state.version + 1,
    players: {
      ...state.players,
      [actorId]: {
        ...player,
        resources: [...player.resources, newToken],
      },
    },
    units: state.units.map((unit) =>
      unit.id === builder.id ? { ...unit, exhausted: true } : unit,
    ),
    buildings: [...state.buildings, newCamp],
  });
}
