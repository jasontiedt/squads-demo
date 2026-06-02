import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { placeholderState, type PublicGameState, type RedactedPlayer } from '../api/client.js';
import { Board } from '../components/board/Board.js';
import { ResourceBank } from '../components/hud/ResourceBank.js';
import type { BuildingInstance, ResourceToken, Seat, Tile } from '@eoe/schema';

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

const stateWithMap = (
  overrides: Partial<PublicGameState> = {},
): PublicGameState => ({
  ...placeholderState('ECON01'),
  map: {
    tiles: [
      makeTile('t-00', 0, 0, ['plain', 'forest', 'farmland', 'plain']),
      makeTile('t-22', 2, 2, ['plain', 'village', 'farmland', 'gold-double']),
    ] as Tile[],
  },
  ...overrides,
});

const makePlayer = (
  seat: Seat,
  resources: readonly ResourceToken[],
): RedactedPlayer =>
  ({
    seat,
    civ: 'english',
    capitalHp: 10,
    capitalSquare: { x: 0, y: 0 },
    hand: { count: 0 },
    deck: [],
    discard: [],
    resources,
    temporaryResources: [],
    activeEvents: [],
    unitField: { kingPawnUsed: false, queenPawnUsed: false },
    civCardId: 'civ:english',
  }) as unknown as RedactedPlayer;

describe('board economy UI', () => {
  it('renders camp and barracks markers on their board squares', () => {
    const camp: BuildingInstance = {
      id: 'camp-1' as BuildingInstance['id'],
      type: 'camp',
      owner: 1,
      square: { x: 1, y: 2 },
      damage: 0,
      terrain: 'forest',
    };
    const barracks: BuildingInstance = {
      id: 'barracks-1' as BuildingInstance['id'],
      type: 'barracks',
      owner: 2,
      square: { x: 4, y: 3 },
      damage: 0,
    };

    render(<Board state={stateWithMap({ buildings: [camp, barracks] })} />);

    expect(screen.getByTestId('building-camp-1').getAttribute('data-square-x')).toBe('1');
    expect(screen.getByTestId('building-camp-1').getAttribute('data-square-y')).toBe('2');
    expect(screen.getByTestId('building-camp-1').getAttribute('data-building-type')).toBe(
      'camp',
    );
    expect(screen.getByTestId('building-barracks-1').getAttribute('data-square-x')).toBe(
      '4',
    );
    expect(screen.getByTestId('building-barracks-1').getAttribute('data-square-y')).toBe(
      '3',
    );
    expect(
      screen.getByTestId('building-barracks-1').getAttribute('data-building-type'),
    ).toBe('barracks');
  });

  it('updates the resource bank as token state changes', () => {
    const freshFood: ResourceToken = {
      id: 'food-1' as ResourceToken['id'],
      kind: 'food',
      exhausted: false,
    };
    const gold: ResourceToken = {
      id: 'gold-1' as ResourceToken['id'],
      kind: 'gold',
      exhausted: false,
    };
    const { rerender } = render(
      <ResourceBank player={makePlayer(1, [freshFood])} label="You" />,
    );

    expect(screen.getByTestId('resource-food-0').getAttribute('data-exhausted')).toBe(
      'false',
    );
    expect(screen.queryByTestId('resource-gold-0')).toBeNull();

    rerender(
      <ResourceBank
        player={makePlayer(1, [{ ...freshFood, exhausted: true }, gold])}
        label="You"
      />,
    );

    expect(screen.getByTestId('resource-food-0').getAttribute('data-exhausted')).toBe(
      'true',
    );
    expect(screen.getByTestId('resource-gold-0').getAttribute('data-exhausted')).toBe(
      'false',
    );
  });

  it('marks exhausted resource tokens with the required data attribute', () => {
    render(
      <ResourceBank
        player={makePlayer(1, [
          {
            id: 'wood-1' as ResourceToken['id'],
            kind: 'wood',
            exhausted: true,
          },
          {
            id: 'wood-2' as ResourceToken['id'],
            kind: 'wood',
            exhausted: false,
          },
        ])}
        label="You"
      />,
    );

    expect(screen.getByTestId('resource-wood-0').getAttribute('data-exhausted')).toBe(
      'true',
    );
    expect(screen.getByTestId('resource-wood-1').getAttribute('data-exhausted')).toBe(
      'false',
    );
  });
});
