import {
  ResourceTokenId,
  type BuildingInstanceId,
  type ResourceKind,
  type ResourceToken,
  type TerrainType,
} from '@eoe/schema';

const CAMP_TERRAIN_TO_RESOURCE_KIND: Partial<Record<TerrainType, ResourceKind>> = {
  forest: 'wood',
  farmland: 'food',
  mine: 'gold',
  'gold-double': 'gold',
  village: 'wild',
};

export function resourceKindForCampTerrain(terrain: TerrainType): ResourceKind | null {
  return CAMP_TERRAIN_TO_RESOURCE_KIND[terrain] ?? null;
}

export function campTokenId(campId: BuildingInstanceId): ResourceTokenId {
  return ResourceTokenId.parse(`resource-${campId}`);
}

export function refreshCampTokens(
  resources: ReadonlyArray<ResourceToken>,
  camps: ReadonlyArray<{ id: BuildingInstanceId; terrain: TerrainType }>,
): ResourceToken[] {
  if (camps.length === 0) return [...resources];

  const campIds = new Set<string>(camps.map((camp) => camp.id));
  const kept = resources.filter(
    (token) => token.sourceCampId === undefined || !campIds.has(token.sourceCampId),
  );

  const refreshed = camps.flatMap((camp) => {
    const kind = resourceKindForCampTerrain(camp.terrain);
    if (kind === null) return [];

    const existing = resources.find((token) => token.sourceCampId === camp.id);
    return [
      {
        id: existing?.id ?? campTokenId(camp.id),
        kind,
        exhausted: false,
        sourceCampId: camp.id,
      },
    ];
  });

  return [...kept, ...refreshed];
}
