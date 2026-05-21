import {
  type ActionLogEntry,
  type BuildingInstance,
  type CardId,
  type GameState,
  type Player,
  type Seed,
  type Tile,
  type UnitInstance,
} from '@eoe/schema';

/**
 * Minimal valid 2-player initial state.
 *
 * - English (seat 1) vs Byzantines (seat 2)
 * - phase: 'start', turn: 1, seat 1 active
 * - Each player: 5-card hand using placeholder card IDs, empty deck
 *   (ingest of real card data is out of scope), Capital placed in
 *   opposite corners of the 6×6 base map.
 * - Seat 2 carries `firstPlayerSecondPlayerWild: true` per rulebook.
 *
 * Card and tile IDs are placeholders — once the asset pipeline lands
 * the real catalog, swap them in. The schema doesn't care; the rules
 * engine and asset loader will.
 *
 * Cast to branded id types is intentional: branded IDs are nominal and
 * unforgeable from raw strings. The fixture treats string literals as
 * brand-acceptable inputs the same way `Schema.parse('...')` would.
 */
const cid = (s: string): CardId => s as CardId;

const englishHand: CardId[] = [
  cid('eng-unit-archer'),
  cid('eng-unit-knight'),
  cid('eng-tactic-rally'),
  cid('eng-action-resupply'),
  cid('eng-tech-fletching'),
];

const byzantinesHand: CardId[] = [
  cid('byz-unit-cataphract'),
  cid('byz-unit-skirmisher'),
  cid('byz-tactic-formation'),
  cid('byz-action-recall'),
  cid('byz-tech-greekfire'),
];

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
  hand: englishHand,
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
  hand: byzantinesHand,
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

export const initialState: GameState = {
  version: 0,
  gameId: 'EOE0001',
  seed: 'seed-mvp1-english-vs-byzantines' as Seed,
  phase: 'start',
  activePlayer: 1,
  turn: 1,
  players: {
    1: englishPlayer,
    2: byzantinesPlayer,
  },
  units,
  buildings,
  map: {
    tiles: [englishStartingTile, byzantinesStartingTile],
  },
  moveLog,
};
