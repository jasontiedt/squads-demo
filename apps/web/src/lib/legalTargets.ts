// ─────────────────────────── legalTargets ─────────────────────────
//
// Issue #70 — client-side legal-target computation for the interactive
// board. The Worker re-validates EVERY action via the rules engine
// (`@eoe/rules` applyAction). What lives here is strictly a UI helper
// that pre-filters obviously-illegal targets so the user doesn't get
// red error toasts for every click.
//
// We mirror the geometry rules from `packages/rules/src/{move,attack,
// scout}.ts`, but we deliberately keep the surface narrow:
//   - terrain + occupancy + range for Move
//   - range + mode + friendly-fire for Attack
//   - face-down tile lookup for Scout
//   - capital-only square for Deploy (MVP-3 rules-engine constraint)
//
// We do NOT reproduce the full "this card exists in catalog" /
// "attacker.attackMode matches action.mode" guards — those rule out
// edge cases the UI can't even surface (the picker only offers legal
// modes). Anything the UI misses, the Worker catches and the toast
// surfaces.

import { loadCivMeta } from '@eoe/assets-meta';
import type {
  Card,
  Civ,
  Coord,
  Seat,
  TerrainType,
  UnitInstance,
} from '@eoe/schema';
import type { PublicGameState } from '../api/client.js';

// ─────────────────────────── Helpers ────────────────────────────────

/** Stable string key for a coord — same shape used by Board.tsx. */
export const coordKey = (c: Coord): string => `${c.x},${c.y}`;

/** Chebyshev distance (matches `packages/rules/src/move.ts`). */
export const chebyshev = (a: Coord, b: Coord): number => {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx > dy ? dx : dy;
};

/** Adjacent squares (8-way, Chebyshev=1). */
export const adjacentCoords = (c: Coord): Coord[] => {
  const out: Coord[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = c.x + dx;
      const y = c.y + dy;
      if (x < 0 || x > 5 || y < 0 || y > 5) continue;
      out.push({ x, y });
    }
  }
  return out;
};

/** Index of `(square → terrain | null)` for revealed face-up tiles. */
const indexTerrain = (
  state: PublicGameState,
): ReadonlyMap<string, TerrainType> => {
  const out = new Map<string, TerrainType>();
  for (const tile of state.map.tiles) {
    if (tile.faceDown) continue;
    for (const sq of tile.squares) {
      out.set(coordKey(sq.coord), sq.terrain);
    }
  }
  return out;
};

/** Index of `(square → tile.faceDown)` for ALL tiles (face-down included). */
const indexFaceDownSquares = (
  state: PublicGameState,
): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const tile of state.map.tiles) {
    if (!tile.faceDown) continue;
    for (const sq of tile.squares) out.add(coordKey(sq.coord));
  }
  return out;
};

/** Square is occupied by ANY unit (friend or enemy). */
const isOccupied = (state: PublicGameState, c: Coord): boolean =>
  state.units.some((u) => u.square.x === c.x && u.square.y === c.y);

/** Look up a unit card by id for a given civ (returns undefined if not found). */
const findUnitCard = (civ: Civ, cardId: string): Card | undefined => {
  const catalog = loadCivMeta(civ);
  return catalog.find((c) => c.id === cardId);
};

// ─────────────────────────── Move ───────────────────────────────────

/**
 * Squares this unit can MOVE to right now. Mirrors `packages/rules/src/move.ts`
 * but stops at the geometry/terrain/occupancy layer.
 *
 * Rules applied:
 *  - unit not exhausted
 *  - Chebyshev distance ≤ unit.movement.points (from catalog)
 *  - destination square sits on a revealed (faceDown:false) tile
 *  - destination terrain is not water/mountain
 *  - destination is not occupied
 *  - destination is not the origin square
 */
export const computeMoveTargets = (
  state: PublicGameState,
  unit: UnitInstance,
  civ: Civ,
): ReadonlySet<string> => {
  const out = new Set<string>();
  if (unit.exhausted) return out;

  const card = findUnitCard(civ, unit.cardId);
  if (card === undefined || card.kind !== 'unit') return out;

  const points = card.movement.points;
  if (points <= 0) return out;

  const terrain = indexTerrain(state);

  for (let y = 0; y < 6; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      if (x === unit.square.x && y === unit.square.y) continue;
      const dist = chebyshev(unit.square, { x, y });
      if (dist > points) continue;
      const key = `${x},${y}`;
      const t = terrain.get(key);
      if (t === undefined) continue; // face-down or off-map
      if (t === 'water' || t === 'mountain') continue;
      if (isOccupied(state, { x, y })) continue;
      out.add(key);
    }
  }
  return out;
};

// ─────────────────────────── Attack ─────────────────────────────────

/**
 * Enemy units this unit can ATTACK with the given mode. Mirrors
 * `packages/rules/src/attack.ts` range geometry:
 *   - melee  → Chebyshev distance == 1
 *   - ranged → Chebyshev distance >= 2
 *
 * Pre-filters: attacker not exhausted, target not own seat, card has
 * non-zero stat for that mode.
 */
export const computeAttackUnitTargets = (
  state: PublicGameState,
  attacker: UnitInstance,
  civ: Civ,
  mode: 'melee' | 'ranged',
): ReadonlySet<string> => {
  const out = new Set<string>();
  if (attacker.exhausted) return out;

  const card = findUnitCard(civ, attacker.cardId);
  if (card === undefined || card.kind !== 'unit') return out;
  const stat = mode === 'melee' ? card.melee : card.ranged;
  if (stat <= 0) return out;

  for (const u of state.units) {
    if (u.owner === attacker.owner) continue;
    if (u.id === attacker.id) continue;
    const cheb = chebyshev(attacker.square, u.square);
    if (mode === 'melee' && cheb !== 1) continue;
    if (mode === 'ranged' && cheb < 2) continue;
    out.add(u.id);
  }
  return out;
};

// ─────────────────────────── Scout ──────────────────────────────────

/**
 * Face-down tile squares reachable by Scout from this unit. The current
 * rules-engine (`packages/rules/src/scout.ts`) does NOT enforce
 * adjacency yet (MVP-3 simplification), but the UI per #70 spec
 * limits picks to ADJACENT face-down tiles to keep the picker tight.
 * The Worker will accept further targets — but the UI won't offer them.
 */
export const computeScoutTargets = (
  state: PublicGameState,
  unit: UnitInstance,
): ReadonlySet<string> => {
  const out = new Set<string>();
  if (unit.exhausted) return out;

  const faceDown = indexFaceDownSquares(state);
  for (const adj of adjacentCoords(unit.square)) {
    const key = coordKey(adj);
    if (faceDown.has(key)) out.add(key);
  }
  return out;
};

// ─────────────────────────── Deploy ─────────────────────────────────

/**
 * Squares where the actor can deploy a unit from their hand. MVP-3
 * rules-engine constraint (`packages/rules/src/deployUnit.ts`) pins
 * this to the actor's `capitalSquare` only. Spec #70 mentions
 * "adjacent to own Capital" — that's the future shape (when Barracks
 * lift), but for MVP-4 we match what the rules engine will accept:
 * the capital square itself.
 *
 * Returns coord keys (consistent with the move/scout helpers).
 */
export const computeDeployTargets = (
  state: PublicGameState,
  seat: Seat,
): ReadonlySet<string> => {
  const out = new Set<string>();
  const player = state.players[seat];
  if (player === undefined) return out;
  const cap = player.capitalSquare;
  // Capital tile must be revealed for the rules engine to accept; mirror
  // that check so the picker doesn't offer a guaranteed-rejected square.
  const terrain = indexTerrain(state);
  if (!terrain.has(coordKey(cap))) return out;
  out.add(coordKey(cap));
  return out;
};

// ─────────────────────────── Attack-mode detection ──────────────────

/**
 * Which attack modes the unit *could* use right now (non-zero stat AND
 * at least one in-range enemy). Used by the UI to decide whether to
 * show a mode toggle. Returns a set: `'melee'`, `'ranged'`, both, or
 * neither.
 */
export const computeAvailableAttackModes = (
  state: PublicGameState,
  attacker: UnitInstance,
  civ: Civ,
): ReadonlySet<'melee' | 'ranged'> => {
  const out = new Set<'melee' | 'ranged'>();
  for (const mode of ['melee', 'ranged'] as const) {
    if (computeAttackUnitTargets(state, attacker, civ, mode).size > 0) {
      out.add(mode);
    }
  }
  return out;
};
