import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Board } from './Board.js';
import { placeholderState, type PublicGameState } from '../../api/client.js';
import type {
  BuildingInstance,
  Tile,
  UnitInstance,
} from '@eoe/schema';

// ─────────────────────────── Fixtures ───────────────────────────────
//
// Hand-built tiles covering all 36 squares with a representative mix
// of terrain. Tile ids/orientations are arbitrary — the renderer cares
// only about `squares[*].coord` and `squares[*].terrain`.

const makeTile = (
  id: string,
  ox: number,
  oy: number,
  terrains: [string, string, string, string],
): Tile =>
  ({
    id,
    kind: 'starting',
    orientation: 0,
    faceDown: false,
    squares: [
      { coord: { x: ox, y: oy }, terrain: terrains[0] },
      { coord: { x: ox + 1, y: oy }, terrain: terrains[1] },
      { coord: { x: ox, y: oy + 1 }, terrain: terrains[2] },
      { coord: { x: ox + 1, y: oy + 1 }, terrain: terrains[3] },
    ],
  }) as Tile;

const fullMapTiles: readonly Tile[] = [
  makeTile('t-00', 0, 0, ['plain', 'forest', 'farmland', 'plain']),
  makeTile('t-20', 2, 0, ['mountain', 'plain', 'village', 'forest']),
  makeTile('t-40', 4, 0, ['water', 'river', 'plain', 'mine']),
  makeTile('t-02', 0, 2, ['farmland', 'plain', 'forest', 'mountain']),
  makeTile('t-22', 2, 2, ['plain', 'village', 'farmland', 'gold-double']),
  makeTile('t-42', 4, 2, ['river', 'water', 'mine', 'plain']),
  makeTile('t-04', 0, 4, ['mountain', 'plain', 'forest', 'farmland']),
  makeTile('t-24', 2, 4, ['plain', 'forest', 'village', 'plain']),
  makeTile('t-44', 4, 4, ['mine', 'plain', 'farmland', 'water']),
];

const stateWithMap = (
  overrides: Partial<PublicGameState> = {},
): PublicGameState => ({
  ...placeholderState('TEST01'),
  map: { tiles: fullMapTiles as Tile[] },
  ...overrides,
});

describe('<Board />', () => {
  it('renders the root board with data-testid="board"', () => {
    render(<Board state={stateWithMap()} />);
    const board = screen.getByTestId('board');
    expect(board).toBeDefined();
    expect(board.getAttribute('data-board-size')).toBe('6');
  });

  it('renders all 36 squares as region-{x}-{y}', () => {
    render(<Board state={stateWithMap()} />);
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        expect(screen.getByTestId(`region-${x}-${y}`)).toBeDefined();
      }
    }
  });

  it('exposes terrain via data-terrain on each region', () => {
    render(<Board state={stateWithMap()} />);
    // Tile t-00 at (0,0): plain | forest | farmland | plain
    expect(
      screen.getByTestId('region-0-0').getAttribute('data-terrain'),
    ).toBe('plain');
    expect(
      screen.getByTestId('region-1-0').getAttribute('data-terrain'),
    ).toBe('forest');
    expect(
      screen.getByTestId('region-0-1').getAttribute('data-terrain'),
    ).toBe('farmland');
    // Tile t-22 at (2,2): plain | village | farmland | gold-double
    expect(
      screen.getByTestId('region-3-3').getAttribute('data-terrain'),
    ).toBe('gold-double');
  });

  it('renders an empty 6×6 grid when the map has no tiles (placeholder state)', () => {
    render(<Board state={placeholderState('STUB42')} />);
    expect(screen.getByTestId('board')).toBeDefined();
    expect(screen.getAllByTestId(/^region-\d-\d$/)).toHaveLength(36);
    expect(
      screen.getByTestId('region-0-0').getAttribute('data-terrain'),
    ).toBe('unrevealed');
  });

  it('renders units with seat-coloured markers', () => {
    const unit: UnitInstance = {
      id: 'u-1',
      cardId: 'card-1',
      owner: 1,
      square: { x: 0, y: 0 },
      exhausted: false,
      damage: 0,
      attackMode: 'melee',
      upgrades: [],
    } as unknown as UnitInstance;
    render(<Board state={stateWithMap({ units: [unit] })} />);
    const marker = screen.getByTestId('unit-u-1');
    expect(marker).toBeDefined();
    expect(marker.getAttribute('data-owner')).toBe('1');
    expect(marker.getAttribute('data-exhausted')).toBe('false');
  });

  it('renders buildings with seat-coloured markers and type metadata', () => {
    const capital: BuildingInstance = {
      id: 'b-cap-1',
      type: 'capital',
      owner: 1,
      square: { x: 0, y: 0 },
      damage: 0,
    };
    render(<Board state={stateWithMap({ buildings: [capital] })} />);
    const marker = screen.getByTestId('building-b-cap-1');
    expect(marker).toBeDefined();
    expect(marker.getAttribute('data-building-type')).toBe('capital');
  });
});
