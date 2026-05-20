import { describe, expect, it } from 'vitest';
import {
  Coord,
  Square,
  TerrainType,
  Tile,
  TileKind,
  TileOrientation,
} from '../index.js';

describe('Coord', () => {
  it('accepts valid in-bounds coordinates', () => {
    const parsed = Coord.parse({ x: 0, y: 0 });
    expect(parsed).toEqual({ x: 0, y: 0 });
    expect(Coord.parse({ x: 5, y: 5 })).toEqual({ x: 5, y: 5 });
    expect(Coord.parse({ x: 3, y: 2 })).toEqual({ x: 3, y: 2 });
  });

  it('rejects out-of-bounds coordinates', () => {
    expect(Coord.safeParse({ x: -1, y: 0 }).success).toBe(false);
    expect(Coord.safeParse({ x: 6, y: 0 }).success).toBe(false);
    expect(Coord.safeParse({ x: 0, y: 6 }).success).toBe(false);
  });

  it('rejects non-integer coordinates', () => {
    expect(Coord.safeParse({ x: 1.5, y: 2 }).success).toBe(false);
    expect(Coord.safeParse({ x: 'a', y: 0 }).success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(Coord.safeParse({ x: 0 }).success).toBe(false);
    expect(Coord.safeParse({}).success).toBe(false);
  });
});

describe('TerrainType', () => {
  it('accepts every documented terrain', () => {
    const all = [
      'plain',
      'mountain',
      'water',
      'river',
      'village',
      'farmland',
      'forest',
      'mine',
      'gold-double',
    ] as const;
    for (const t of all) {
      expect(TerrainType.parse(t)).toBe(t);
    }
  });

  it('rejects unknown terrain', () => {
    expect(TerrainType.safeParse('desert').success).toBe(false);
    expect(TerrainType.safeParse('').success).toBe(false);
    expect(TerrainType.safeParse(undefined).success).toBe(false);
  });
});

describe('Square', () => {
  it('round-trips a valid square', () => {
    const sq = { coord: { x: 2, y: 3 }, terrain: 'forest' as const };
    expect(Square.parse(sq)).toEqual(sq);
  });

  it('rejects an invalid coord or terrain', () => {
    expect(Square.safeParse({ coord: { x: 9, y: 0 }, terrain: 'plain' }).success).toBe(false);
    expect(Square.safeParse({ coord: { x: 0, y: 0 }, terrain: 'desert' }).success).toBe(false);
  });
});

describe('TileOrientation', () => {
  it('accepts the four cardinal rotations', () => {
    expect(TileOrientation.parse(0)).toBe(0);
    expect(TileOrientation.parse(90)).toBe(90);
    expect(TileOrientation.parse(180)).toBe(180);
    expect(TileOrientation.parse(270)).toBe(270);
  });

  it('rejects other rotations', () => {
    expect(TileOrientation.safeParse(45).success).toBe(false);
    expect(TileOrientation.safeParse(360).success).toBe(false);
    expect(TileOrientation.safeParse('90').success).toBe(false);
  });
});

describe('TileKind', () => {
  it('accepts known kinds', () => {
    expect(TileKind.parse('starting')).toBe('starting');
    expect(TileKind.parse('highland')).toBe('highland');
    expect(TileKind.parse('constantinople')).toBe('constantinople');
  });

  it('rejects unknown kinds', () => {
    expect(TileKind.safeParse('city').success).toBe(false);
  });
});

describe('Tile', () => {
  const validTile = {
    id: 'tile-0-0',
    kind: 'starting' as const,
    orientation: 0 as const,
    faceDown: false,
    squares: [
      { coord: { x: 0, y: 0 }, terrain: 'plain' as const },
      { coord: { x: 1, y: 0 }, terrain: 'farmland' as const },
      { coord: { x: 0, y: 1 }, terrain: 'forest' as const },
      { coord: { x: 1, y: 1 }, terrain: 'village' as const },
    ],
  };

  it('round-trips a valid tile', () => {
    expect(Tile.parse(validTile)).toEqual(validTile);
  });

  it('accepts a face-down tile', () => {
    expect(Tile.parse({ ...validTile, faceDown: true })).toMatchObject({ faceDown: true });
  });

  it('rejects a tile with the wrong number of squares', () => {
    expect(Tile.safeParse({ ...validTile, squares: validTile.squares.slice(0, 3) }).success).toBe(false);
    expect(
      Tile.safeParse({ ...validTile, squares: [...validTile.squares, validTile.squares[0]] })
        .success,
    ).toBe(false);
  });

  it('rejects a tile with an empty id', () => {
    expect(Tile.safeParse({ ...validTile, id: '' }).success).toBe(false);
  });

  it('rejects a tile with an invalid orientation', () => {
    expect(Tile.safeParse({ ...validTile, orientation: 45 }).success).toBe(false);
  });

  it('rejects a tile containing an invalid square', () => {
    const bad = {
      ...validTile,
      squares: [
        ...validTile.squares.slice(0, 3),
        { coord: { x: 9, y: 9 }, terrain: 'plain' as const },
      ],
    };
    expect(Tile.safeParse(bad).success).toBe(false);
  });
});
