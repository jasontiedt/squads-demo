import type {
  ActionLogEntry,
  BuildingInstance,
  CardId,
  GameState,
  Player,
  Seat,
  Seed,
  Tile,
  TurnPhase,
  UnitInstance,
} from '@eoe/schema';

// ─────────────────────────── Minimal test fixture ────────────────────
//
// Local copy of the canonical `initialState` so the rules package
// stays free of any workspace dep on `apps/worker`. Mirrors
// `apps/worker/test/fixtures/initial-state.ts` (English vs Byzantines)
// but trimmed to only what phase-machine tests need.
//
// Cast to branded id types is intentional — branded IDs are nominal,
// and these literals stand in for asset-pipeline outputs.

const cid = (s: string): CardId => s as CardId;

const englishCapital: BuildingInstance = {
  id: 'b-cap-1' as BuildingInstance['id'],
  type: 'capital',
  owner: 1,
  square: { x: 0, y: 0 },
  damage: 0,
};

const byzantinesCapital: BuildingInstance = {
  id: 'b-cap-2' as BuildingInstance['id'],
  type: 'capital',
  owner: 2,
  square: { x: 5, y: 5 },
  damage: 0,
};

const englishStartingTile: Tile = {
  id: 't-eng-start',
  kind: 'starting',
  orientation: 0,
  faceDown: false,
  squares: [
    { coord: { x: 0, y: 0 }, terrain: 'plain' },
    { coord: { x: 1, y: 0 }, terrain: 'forest' },
    { coord: { x: 0, y: 1 }, terrain: 'farmland' },
    { coord: { x: 1, y: 1 }, terrain: 'plain' },
  ],
};

const byzantinesStartingTile: Tile = {
  id: 't-byz-start',
  kind: 'starting',
  orientation: 0,
  faceDown: false,
  squares: [
    { coord: { x: 4, y: 4 }, terrain: 'plain' },
    { coord: { x: 5, y: 4 }, terrain: 'mine' },
    { coord: { x: 4, y: 5 }, terrain: 'village' },
    { coord: { x: 5, y: 5 }, terrain: 'plain' },
  ],
};

const englishPlayer: Player = {
  seat: 1,
  civ: 'english',
  capitalHp: 10,
  capitalSquare: { x: 0, y: 0 },
  hand: [cid('eng-unit-archer')],
  deck: [],
  discard: [],
  resources: [],
  temporaryResources: [],
  activeEvents: [],
  unitField: { kingPawnUsed: false, queenPawnUsed: false },
  civCardId: cid('eng-civ'),
};

const byzantinesPlayer: Player = {
  seat: 2,
  civ: 'byzantines',
  capitalHp: 10,
  capitalSquare: { x: 5, y: 5 },
  hand: [cid('byz-unit-cataphract')],
  deck: [],
  discard: [],
  resources: [],
  temporaryResources: [],
  activeEvents: [],
  unitField: { kingPawnUsed: false, queenPawnUsed: false },
  civCardId: cid('byz-civ'),
  firstPlayerSecondPlayerWild: true,
};

const units: UnitInstance[] = [];
const buildings: BuildingInstance[] = [englishCapital, byzantinesCapital];
const moveLog: ActionLogEntry[] = [];

export const baseState: GameState = {
  version: 0,
  gameId: 'EOE0001',
  seed: 'seed-rules-tests' as Seed,
  phase: 'start',
  activePlayer: 1,
  turn: 1,
  players: {
    1: englishPlayer,
    2: byzantinesPlayer,
  },
  units,
  buildings,
  map: { tiles: [englishStartingTile, byzantinesStartingTile] },
  moveLog,
};

/** Shallow override for `phase` + `activePlayer` + `turn`. */
export function withState(
  patch: Partial<Pick<GameState, 'phase' | 'activePlayer' | 'turn'>>,
): GameState {
  return { ...baseState, ...patch };
}

export const ALL_PHASES: ReadonlyArray<TurnPhase> = [
  'start',
  'mobilization',
  'deployment',
  'end',
  'ended',
];

export const SEAT_1: Seat = 1;
export const SEAT_2: Seat = 2;
