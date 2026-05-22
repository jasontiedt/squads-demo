// ─────────────────────────── Initial state factory ─────────────────
//
// Pure, deterministic construction of `GameState` for new games.
// Extracted from `apps/worker/src/game-init.ts` in #57 so the engine
// owns the determinism contract and tests can exercise it without the
// worker harness.
//
// Two operations:
//   • `buildCreatorState` — seat-1-only state created by POST /games.
//     Phase `start`, turn 1, activePlayer 1, seat-1 deck shuffled and
//     5-card hand drawn. Seat 2's slot is empty until `addJoiner` runs.
//   • `addJoiner` — folds seat-2 into an existing creator state,
//     bumps version, shuffles seat-2 deck against the SAME seed (with
//     a per-seat salt), draws seat-2 hand, places seat-2 capital +
//     starting tile, and flags `firstPlayerSecondPlayerWild`.
//
// Both functions are pure: no I/O, no `Date.now`, no `Math.random`.
// All randomness flows from the supplied `seed` via `mulberry32` +
// `seedFor` from `./rng.ts`.

import { loadCivMeta } from '@eoe/assets-meta';
import {
  type BuildingInstance,
  type BuildingInstanceId,
  type CardId,
  type Civ,
  type Coord,
  type GameState,
  type Player,
  type Seed,
  type Tile,
} from '@eoe/schema';
import {
  CAPITAL_DEFAULT_HP,
  MIN_DECK_AFTER_DRAW,
  STARTING_HAND_SIZE,
} from './constants.js';
import { mulberry32, seedFor } from './rng.js';
import { shuffleWith } from './shuffle.js';

// ─────────────────────────── Starting tiles ─────────────────────────
//
// `STARTING_TILES[0]` belongs to player 1, `STARTING_TILES[-1]` to
// player 2 (issue #57 spec). Both face-up at init so units can deploy.
//
// @needs-confirmation: starting-tile terrain is a placeholder. The
// rulebook ships dedicated starting-tile cards (see
// `documentation/StartingTiles.txt`) not yet ingested. MVP-4 will
// randomize placement; for MVP-3 the deterministic p1=first / p2=last
// rule is enough.

function seat1StartingTile(): Tile {
  return {
    id: 't-start-p1',
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

function seat2StartingTile(): Tile {
  return {
    id: 't-start-p2',
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

/** Capital anchor square per seat. Within the starting tile's squares. */
const CAPITAL_SQUARE: Record<1 | 2, Coord> = {
  1: { x: 0, y: 0 },
  2: { x: 5, y: 5 },
};

// ─────────────────────────── Deck + hand ────────────────────────────

/**
 * Build a player's shuffled deck of card IDs from the civ catalog.
 *
 * The catalog (via `loadCivMeta`) currently holds a tiny placeholder
 * set for Byzantines and an MVP subset for English. `civilization`-kind
 * cards are stripped (they belong on `Player.civCardId`), then the
 * playable set is padded with civ-namespaced placeholders
 * (`<civ>-placeholder-<n>`) so every game can draw a 5-card hand and
 * still have a non-empty deck afterwards.
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
function buildPlayer(seat: 1 | 2, civ: Civ, seed: Seed): Player {
  const capitalSquare = CAPITAL_SQUARE[seat];
  const shuffled = buildDeck(civ, seed, seat);
  const hand = shuffled.slice(0, STARTING_HAND_SIZE);
  const deck = shuffled.slice(STARTING_HAND_SIZE);
  const player: Player = {
    seat,
    civ,
    capitalHp: CAPITAL_DEFAULT_HP,
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

/** Capital `BuildingInstance` for a given seat. */
function buildCapital(seat: 1 | 2): BuildingInstance {
  return {
    id: `bld-cap-p${seat}` as BuildingInstanceId,
    type: 'capital',
    owner: seat,
    square: CAPITAL_SQUARE[seat],
    damage: 0,
  };
}

// ─────────────────────────── Public factory ─────────────────────────

/**
 * Build the seat-1-only initial state produced by POST /games.
 *
 * Deterministic: same `(gameCode, seed, civ)` → identical state.
 */
export function buildCreatorState(
  gameCode: string,
  seed: Seed,
  civ: Civ,
): GameState {
  return {
    version: 1,
    gameId: gameCode,
    seed,
    phase: 'start',
    activePlayer: 1,
    turn: 1,
    players: { 1: buildPlayer(1, civ, seed) },
    units: [],
    buildings: [buildCapital(1)],
    map: { tiles: [seat1StartingTile()] },
    moveLog: [],
  };
}

/**
 * Fold the seat-2 player into an existing creator state. Returns a
 * brand-new state — the input is never mutated.
 *
 * Version bump (1 → 2) acknowledges the join as a state-changing event,
 * matching the optimistic-concurrency contract action handlers follow.
 */
export function addJoiner(state: GameState, civ: Civ): GameState {
  const seat2 = buildPlayer(2, civ, state.seed);
  return {
    ...state,
    version: state.version + 1,
    players: { ...state.players, 2: seat2 },
    buildings: [...state.buildings, buildCapital(2)],
    map: { ...state.map, tiles: [...state.map.tiles, seat2StartingTile()] },
  };
}
