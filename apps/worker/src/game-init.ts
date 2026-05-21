// ─────────────────────────── Game initialization ────────────────────
//
// Pure functions that build the initial `GameState` for issue #12.
//
// Two operations:
//   • `buildCreatorState` — seat-1 only state created by POST /games.
//     Phase `start`, turn 1, activePlayer 1, seat-1 deck shuffled and
//     hand drawn. Seat 2's slot is empty until `addJoiner` runs.
//   • `addJoiner` — folds the seat-2 player into an existing creator
//     state. Shuffles seat 2's deck with the SAME seed (but a different
//     salt), draws seat 2's hand, places seat 2's capital + starting
//     tile, and flags `firstPlayerSecondPlayerWild`.
//
// Both functions are pure — no I/O, no Date.now, no Math.random. All
// randomness flows from the supplied `seed` string via the seeded PRNG
// in `@eoe/rules`. The Worker route handlers wrap these with KV I/O.
//
// Card-source contract:
//   `loadCivMeta(civ)` (from `@eoe/assets-meta`) returns the canonical
//   card catalog for the civ. We exclude `civilization`-kind entries
//   from the deck (those live on `Player.civCardId`), and pad with
//   civ-namespaced placeholder ids if the catalog isn't large enough to
//   support a 5-card draw + a follow-on deck. This keeps MVP-1 games
//   playable while Sabine's civ ingest (#10, #11, #17) catches up.

import { loadCivMeta } from '@eoe/assets-meta';
import {
  type BuildingInstance,
  type CardId,
  type Civ,
  type GameState,
  type Player,
  type Seed,
  type Tile,
} from '@eoe/schema';
import { mulberry32, seedFor } from '@eoe/rules';
import { shuffleWith } from './random.js';

/** Hand size at game start — rulebook §"Setup". */
export const STARTING_HAND_SIZE = 5;

/** Capital HP for the base game — rulebook §"Setup" line 77. */
const STARTING_CAPITAL_HP = 10;

/** Minimum deck size after the opening hand has been drawn. */
const MIN_DECK_AFTER_DRAW = 7;

/**
 * Build the canonical seat-1 starting tile. Anchored at (0,0)..(1,1).
 * Terrain copied from the existing MVP-1 fixture so behavior stays
 * stable across the create flow and existing tests.
 *
 * @needs-confirmation: starting-tile terrain layout is a placeholder.
 * The rulebook ships dedicated starting-tile cards (see
 * `documentation/StartingTiles.txt`) that aren't yet ingested; this
 * shape pins the engine's interpretation for now and should be replaced
 * once the real catalog lands.
 */
function seat1StartingTile(): Tile {
  return {
    id: 't-start-seat-1',
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
}

/** Seat-2 starting tile anchored at (4,4)..(5,5). Same placeholder note. */
function seat2StartingTile(): Tile {
  return {
    id: 't-start-seat-2',
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
}

/**
 * Build a player's full shuffled deck of card IDs from the civ catalog.
 *
 * The catalog (via `loadCivMeta`) currently holds a tiny placeholder
 * set for Byzantines and an MVP subset for English. We strip
 * `civilization`-kind cards (they belong on `Player.civCardId`, not the
 * deck), then pad with civ-namespaced placeholders so every game can
 * draw a 5-card hand and still have a non-empty deck afterwards.
 * Padding entries follow the id convention `<civ>-placeholder-<n>`.
 *
 * Shuffle is deterministic via `mulberry32(seedFor(...))`.
 */
function buildDeck(civ: Civ, seed: Seed, seat: 1 | 2): readonly CardId[] {
  const catalogue = loadCivMeta(civ);
  const playable: CardId[] = [];
  for (const card of catalogue) {
    if (card.kind === 'civilization') continue;
    playable.push(card.id);
  }

  const targetDeckSize = STARTING_HAND_SIZE + MIN_DECK_AFTER_DRAW;
  for (let i = playable.length; i < targetDeckSize; i++) {
    playable.push(`${civ}-placeholder-${i}` as CardId);
  }

  const rngSeed = seedFor(
    { seed, turn: 1, activePlayer: 1 },
    `shuffle:deck:${seat}`,
  );
  return shuffleWith(playable, mulberry32(rngSeed));
}

/** Pick the civ-card id from the catalog or fall back to a placeholder. */
function pickCivCardId(civ: Civ): CardId {
  for (const card of loadCivMeta(civ)) {
    if (card.kind === 'civilization') return card.id;
  }
  return `${civ}-civ` as CardId;
}

/** Build a fully populated `Player` with a shuffled deck and 5-card hand. */
function buildPlayer(
  seat: 1 | 2,
  civ: Civ,
  seed: Seed,
  capitalSquare: { readonly x: number; readonly y: number },
): Player {
  const shuffled = buildDeck(civ, seed, seat);
  const hand = shuffled.slice(0, STARTING_HAND_SIZE);
  const deck = shuffled.slice(STARTING_HAND_SIZE);
  const player: Player = {
    seat,
    civ,
    capitalHp: STARTING_CAPITAL_HP,
    capitalSquare,
    hand: [...hand],
    deck: [...deck],
    discard: [],
    resources: [],
    temporaryResources: [],
    activeEvents: [],
    unitField: { kingPawnUsed: false, queenPawnUsed: false },
    civCardId: pickCivCardId(civ),
  };
  if (seat === 2) {
    return { ...player, firstPlayerSecondPlayerWild: true };
  }
  return player;
}

/**
 * Build the seat-1-only initial state produced by POST /games.
 *
 * @needs-confirmation: capital placement at (0,0) for seat 1 and (5,5)
 * for seat 2 is an engineering choice — the rulebook places capitals
 * in opposite corners but doesn't pin specific board-flat squares.
 * Replace with the canonical setup once it lands.
 */
export function buildCreatorState(
  gameCode: string,
  seed: Seed,
  civ: Civ,
): GameState {
  const seat1 = buildPlayer(1, civ, seed, { x: 0, y: 0 });
  const seat1Capital: BuildingInstance = {
    id: 'b-cap-seat-1' as BuildingInstance['id'],
    type: 'capital',
    owner: 1,
    square: { x: 0, y: 0 },
    damage: 0,
  };
  return {
    version: 1,
    gameId: gameCode,
    seed,
    phase: 'start',
    activePlayer: 1,
    turn: 1,
    players: { 1: seat1 },
    units: [],
    buildings: [seat1Capital],
    map: { tiles: [seat1StartingTile()] },
    moveLog: [],
  };
}

/**
 * Fold the seat-2 player into an existing creator state. Returns a
 * brand-new state — the input is never mutated.
 *
 * The version bump (1 → 2) acknowledges the join as a state-changing
 * event, matching the optimistic-concurrency contract that action
 * handlers will follow in #13.
 */
export function addJoiner(state: GameState, civ: Civ): GameState {
  const seat2 = buildPlayer(2, civ, state.seed, { x: 5, y: 5 });
  const seat2Capital: BuildingInstance = {
    id: 'b-cap-seat-2' as BuildingInstance['id'],
    type: 'capital',
    owner: 2,
    square: { x: 5, y: 5 },
    damage: 0,
  };
  return {
    ...state,
    version: state.version + 1,
    players: { ...state.players, 2: seat2 },
    buildings: [...state.buildings, seat2Capital],
    map: { ...state.map, tiles: [...state.map.tiles, seat2StartingTile()] },
  };
}
