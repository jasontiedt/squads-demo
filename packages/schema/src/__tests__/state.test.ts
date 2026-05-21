import { describe, expect, it } from 'vitest';
import {
  ActionLogEntry,
  AttackMode,
  BuildingInstance,
  BuildingInstanceId,
  type CardId,
  type Coord,
  GameState,
  PawnBonus,
  Player,
  Seed,
  TurnPhase,
  UnitInstance,
  UnitInstanceId,
} from '../index.js';

// Helpers — placeholder ids let us build minimal valid states without
// pulling the asset catalog in. Branded types are nominal; raw strings
// pass `z.string().min(1).brand<...>()` validation.
const cid = (s: string): CardId => s as CardId;
const corner: Coord = { x: 0, y: 0 };

const minimalPlayer: Player = {
  seat: 1,
  civ: 'english',
  capitalHp: 10,
  capitalSquare: corner,
  hand: [cid('c1'), cid('c2'), cid('c3'), cid('c4'), cid('c5')],
  deck: [],
  discard: [],
  resources: [],
  temporaryResources: [],
  activeEvents: [],
  unitField: { kingPawnUsed: false, queenPawnUsed: false },
  civCardId: cid('civ-eng'),
};

const minimalState: GameState = {
  version: 0,
  gameId: 'GAME0001',
  seed: 'seed-test' as Seed,
  phase: 'start',
  activePlayer: 1,
  turn: 1,
  players: { 1: minimalPlayer },
  units: [],
  buildings: [],
  map: { tiles: [] },
  moveLog: [],
};

describe('TurnPhase', () => {
  it('accepts the four canonical phases', () => {
    expect(TurnPhase.parse('start')).toBe('start');
    expect(TurnPhase.parse('mobilization')).toBe('mobilization');
    expect(TurnPhase.parse('deployment')).toBe('deployment');
    expect(TurnPhase.parse('end')).toBe('end');
  });

  it('rejects legacy phase names', () => {
    expect(() => TurnPhase.parse('main')).toThrow();
    expect(() => TurnPhase.parse('combat')).toThrow();
  });
});

describe('Branded ids', () => {
  it('UnitInstanceId, BuildingInstanceId and Seed parse non-empty strings', () => {
    expect(UnitInstanceId.parse('u1')).toBe('u1');
    expect(BuildingInstanceId.parse('b1')).toBe('b1');
    expect(Seed.parse('s')).toBe('s');
  });

  it('reject empty strings', () => {
    expect(() => UnitInstanceId.parse('')).toThrow();
    expect(() => BuildingInstanceId.parse('')).toThrow();
    expect(() => Seed.parse('')).toThrow();
  });
});

describe('AttackMode / PawnBonus', () => {
  it('AttackMode is melee or ranged', () => {
    expect(AttackMode.parse('melee')).toBe('melee');
    expect(AttackMode.parse('ranged')).toBe('ranged');
    expect(() => AttackMode.parse('siege')).toThrow();
  });

  it('PawnBonus is king or queen', () => {
    expect(PawnBonus.parse('king')).toBe('king');
    expect(PawnBonus.parse('queen')).toBe('queen');
    expect(() => PawnBonus.parse('rook')).toThrow();
  });
});

describe('Player', () => {
  it('round-trips a minimal valid player', () => {
    expect(Player.parse(minimalPlayer)).toEqual(minimalPlayer);
  });

  it('omits firstPlayerSecondPlayerWild cleanly', () => {
    const parsed = Player.parse(minimalPlayer);
    expect(parsed.firstPlayerSecondPlayerWild).toBeUndefined();
  });

  it('accepts firstPlayerSecondPlayerWild=true (seat 2 wild slot)', () => {
    const seat2: Player = { ...minimalPlayer, seat: 2, firstPlayerSecondPlayerWild: true };
    expect(Player.parse(seat2).firstPlayerSecondPlayerWild).toBe(true);
  });

  it('rejects hand size > 7', () => {
    const hand: CardId[] = Array.from({ length: 8 }, (_, i) => cid(`c${i}`));
    expect(() => Player.parse({ ...minimalPlayer, hand })).toThrow();
  });

  it('rejects activeEvents > 3', () => {
    const events: CardId[] = [cid('e1'), cid('e2'), cid('e3'), cid('e4')];
    expect(() => Player.parse({ ...minimalPlayer, activeEvents: events })).toThrow();
  });

  it('rejects negative capitalHp', () => {
    expect(() => Player.parse({ ...minimalPlayer, capitalHp: -1 })).toThrow();
  });

  for (const field of [
    'seat',
    'civ',
    'capitalHp',
    'capitalSquare',
    'hand',
    'deck',
    'discard',
    'resources',
    'temporaryResources',
    'activeEvents',
    'unitField',
    'civCardId',
  ] as const) {
    it(`rejects player missing required field "${field}"`, () => {
      const partial: Record<string, unknown> = { ...minimalPlayer };
      delete partial[field];
      expect(() => Player.parse(partial)).toThrow();
    });
  }
});

describe('UnitInstance', () => {
  const unit: UnitInstance = {
    id: 'u1' as UnitInstance['id'],
    cardId: cid('eng-archer'),
    owner: 1,
    square: corner,
    exhausted: false,
    damage: 0,
    attackMode: 'ranged',
    upgrades: [],
  };

  it('round-trips a valid unit (no pawnBonus)', () => {
    expect(UnitInstance.parse(unit)).toEqual(unit);
  });

  it('accepts pawnBonus = king', () => {
    const withKing: UnitInstance = { ...unit, pawnBonus: 'king' };
    expect(UnitInstance.parse(withKing).pawnBonus).toBe('king');
  });

  it('rejects negative damage', () => {
    expect(() => UnitInstance.parse({ ...unit, damage: -1 })).toThrow();
  });
});

describe('BuildingInstance (discriminated union)', () => {
  const camp: BuildingInstance = {
    id: 'b-camp' as BuildingInstance['id'],
    type: 'camp',
    owner: 1,
    square: corner,
    damage: 0,
    terrain: 'farmland',
  };

  const barracks: BuildingInstance = {
    id: 'b-bar' as BuildingInstance['id'],
    type: 'barracks',
    owner: 1,
    square: corner,
    damage: 0,
  };

  const capital: BuildingInstance = {
    id: 'b-cap' as BuildingInstance['id'],
    type: 'capital',
    owner: 1,
    square: corner,
    damage: 0,
  };

  it('round-trips Camp / Barracks / Capital', () => {
    expect(BuildingInstance.parse(camp)).toEqual(camp);
    expect(BuildingInstance.parse(barracks)).toEqual(barracks);
    expect(BuildingInstance.parse(capital)).toEqual(capital);
  });

  it('rejects Camp missing terrain', () => {
    const broken = { ...camp } as Partial<typeof camp>;
    delete broken.terrain;
    expect(() => BuildingInstance.parse(broken)).toThrow();
  });

  it('rejects Barracks with terrain (terrain only on Camp)', () => {
    expect(() =>
      BuildingInstance.parse({ ...barracks, terrain: 'plain' } as unknown),
    ).toThrow();
  });

  it('rejects Capital with terrain (terrain only on Camp)', () => {
    expect(() =>
      BuildingInstance.parse({ ...capital, terrain: 'mountain' } as unknown),
    ).toThrow();
  });

  it('rejects unknown type', () => {
    expect(() =>
      BuildingInstance.parse({ ...barracks, type: 'fortress' } as unknown),
    ).toThrow();
  });
});

describe('ActionLogEntry', () => {
  it('round-trips a minimal entry (EndTurn action)', () => {
    const entry = {
      at: '2025-01-01T00:00:00.000Z',
      seat: 1 as const,
      action: { type: 'EndTurn' as const },
    };
    expect(ActionLogEntry.parse(entry)).toEqual(entry);
  });

  it('rejects non-ISO date', () => {
    expect(() =>
      ActionLogEntry.parse({
        at: 'yesterday',
        seat: 1,
        action: { type: 'EndTurn' },
      }),
    ).toThrow();
  });

  it('rejects entry whose action fails the discriminator', () => {
    expect(() =>
      ActionLogEntry.parse({
        at: '2025-01-01T00:00:00.000Z',
        seat: 1,
        action: { type: 'NotAnAction' },
      }),
    ).toThrow();
  });
});

describe('GameState', () => {
  it('round-trips a minimal valid state', () => {
    expect(GameState.parse(minimalState)).toEqual(minimalState);
  });

  it('rejects turn = 0 (turns are 1-indexed)', () => {
    expect(() => GameState.parse({ ...minimalState, turn: 0 })).toThrow();
  });

  it('rejects negative version', () => {
    expect(() => GameState.parse({ ...minimalState, version: -1 })).toThrow();
  });

  it('rejects activePlayer outside 1..4', () => {
    expect(() => GameState.parse({ ...minimalState, activePlayer: 5 as unknown as 1 })).toThrow();
  });

  for (const field of [
    'version',
    'gameId',
    'seed',
    'phase',
    'activePlayer',
    'turn',
    'players',
    'units',
    'buildings',
    'map',
    'moveLog',
  ] as const) {
    it(`rejects state missing required field "${field}"`, () => {
      const partial: Record<string, unknown> = { ...minimalState };
      delete partial[field];
      expect(() => GameState.parse(partial)).toThrow();
    });
  }

  it('accepts pendingReactionWindow when populated', () => {
    const trigger = {
      at: '2025-01-01T00:00:00.000Z',
      seat: 1 as const,
      action: { type: 'EndPhase' as const },
    };
    const withWindow: GameState = {
      ...minimalState,
      pendingReactionWindow: { triggeredBy: trigger },
    };
    expect(GameState.parse(withWindow).pendingReactionWindow?.triggeredBy.action.type).toBe(
      'EndPhase',
    );
  });
});
