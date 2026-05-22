// ─────────────────────────── Board view ─────────────────────────────
//
// Issue #35 (MVP-2 / 2.1). Static, non-interactive render of the
// English_Base map from a polled `PublicGameState`. No click handlers
// here — those land in #37.
//
// Why squares, not hexes
// ──────────────────────
// The issue copy says "hex/region" but the engine model is a 6×6
// SQUARE grid (`Coord { x: 0..5, y: 0..5 }`, tiles are 2×2 squares).
// Rendering hexes would require an extra coord-translation layer that
// disagrees with every other touchpoint (rules engine, action
// payloads, schema validation, future click→Coord targeting in #37).
// We render what the engine sees. See
// `.squad/decisions/inbox/sabine-board-squares-over-hex.md`.
//
// Why SVG, not canvas
// ───────────────────
// 36 cells + a handful of unit/building overlays = well under any
// canvas-vs-SVG perf line. SVG gives us per-element `data-testid`
// hooks for the future click pipeline (#37) with zero extra wiring.

import type { PublicGameState } from '../../api/client.js';
import type { Coord, Seat, TerrainType } from '@eoe/schema';

// ─────────────────────────── Layout constants ───────────────────────

/** Board is always 6×6 squares — matches the rulebook base map. */
const BOARD_SIZE = 6;
/** Each square is drawn this many SVG units on a side. */
const CELL = 64;
/** Outer padding around the grid. */
const PAD = 8;
/** Each 2×2 tile gets a heavier stroke so the tile grid reads visually. */
const TILE_SIZE = 2;

const SVG_DIM = BOARD_SIZE * CELL + PAD * 2;

// ─────────────────────────── Terrain palette ────────────────────────
//
// Spare, calm. Each terrain has one base colour; the renderer fills
// the square with it. No textures, no gradients — readability first.
// These names hold for both English_Base and Byzantine_Base — terrain
// is shared across civs.
const TERRAIN_FILL: Record<TerrainType, string> = {
  plain: '#5b6e3a',
  farmland: '#a3863d',
  forest: '#2f4f2c',
  mountain: '#6e6660',
  water: '#2c5275',
  river: '#3a7397',
  village: '#8a6a3c',
  mine: '#444038',
  'gold-double': '#b08a2e',
};

const TERRAIN_LABEL: Record<TerrainType, string> = {
  plain: 'Plain',
  farmland: 'Farmland',
  forest: 'Forest',
  mountain: 'Mountain',
  water: 'Water',
  river: 'River',
  village: 'Village',
  mine: 'Mine',
  'gold-double': 'Gold (double)',
};

/** Fallback fill for unrevealed / empty squares (no tile data). */
const EMPTY_FILL = '#1c1c1c';

/** Per-seat colour for unit/building markers. Distinct hues, all dark
 *  enough to sit on the terrain palette without becoming noise. */
const SEAT_COLOR: Record<Seat, string> = {
  1: '#d94f4f',
  2: '#4f9ed9',
  3: '#d9b94f',
  4: '#a44fd9',
};

// ─────────────────────────── Helpers ────────────────────────────────

/**
 * Flatten the (possibly empty) tile array into a square-indexed map
 * keyed by `"x,y"`. Returns `undefined` for any square not yet revealed
 * (face-down tile, or no tile at all — common in placeholderState).
 */
function indexSquares(
  state: PublicGameState,
): ReadonlyMap<string, TerrainType> {
  const out = new Map<string, TerrainType>();
  for (const tile of state.map.tiles) {
    if (tile.faceDown) continue;
    for (const sq of tile.squares) {
      out.set(coordKey(sq.coord), sq.terrain);
    }
  }
  return out;
}

const coordKey = (c: Coord): string => `${c.x},${c.y}`;

/** Pixel position for the top-left corner of square `(x, y)`. */
const px = (n: number): number => PAD + n * CELL;

// ─────────────────────────── Component ──────────────────────────────

export interface BoardProps {
  state: PublicGameState;
}

export const Board = ({ state }: BoardProps): JSX.Element => {
  const terrainBySquare = indexSquares(state);

  // Stable 6×6 cell list. We always render all 36 cells — squares with
  // no revealed terrain just get the empty fill. This keeps the SVG
  // structure invariant across polls, which means React keys stay
  // stable and we don't re-create DOM nodes per 2s tick.
  const cells: { x: number; y: number; terrain: TerrainType | null }[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const terrain = terrainBySquare.get(`${x},${y}`) ?? null;
      cells.push({ x, y, terrain });
    }
  }

  return (
    <section
      className="board"
      aria-label="Game board"
      data-testid="board"
      data-board-size={BOARD_SIZE}
    >
      <svg
        viewBox={`0 0 ${SVG_DIM} ${SVG_DIM}`}
        width="100%"
        role="img"
        aria-label={`${BOARD_SIZE} by ${BOARD_SIZE} square game board`}
        className="board-svg"
      >
        {/* Cells */}
        {cells.map(({ x, y, terrain }) => {
          const fill = terrain === null ? EMPTY_FILL : TERRAIN_FILL[terrain];
          const label =
            terrain === null
              ? `Square ${x},${y}: unrevealed`
              : `Square ${x},${y}: ${TERRAIN_LABEL[terrain]}`;
          return (
            <g
              key={`cell-${x}-${y}`}
              data-testid={`region-${x}-${y}`}
              data-terrain={terrain ?? 'unrevealed'}
            >
              <title>{label}</title>
              <rect
                x={px(x)}
                y={px(y)}
                width={CELL}
                height={CELL}
                fill={fill}
                stroke="#0b0b0b"
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* Tile borders — heavier stroke on the 2×2 grid lines. */}
        {Array.from({ length: BOARD_SIZE / TILE_SIZE + 1 }, (_, i) => {
          const pos = px(i * TILE_SIZE);
          return (
            <g key={`tilegrid-${i}`} className="board-tile-grid">
              <line
                x1={pos}
                y1={PAD}
                x2={pos}
                y2={SVG_DIM - PAD}
                stroke="#0b0b0b"
                strokeWidth={2.5}
              />
              <line
                x1={PAD}
                y1={pos}
                x2={SVG_DIM - PAD}
                y2={pos}
                stroke="#0b0b0b"
                strokeWidth={2.5}
              />
            </g>
          );
        })}

        {/* Building markers — drawn before units so a stacked unit
            visually wins (matches engine: only one unit per square). */}
        {state.buildings.map((b) => {
          const cx = px(b.square.x) + CELL / 2;
          const cy = px(b.square.y) + CELL / 2;
          const color = SEAT_COLOR[b.owner];
          // Capitals get a larger marker; barracks/camps a smaller
          // square. Damage is not surfaced yet — that lands when the
          // combat UX shows up.
          const size = b.type === 'capital' ? CELL * 0.45 : CELL * 0.3;
          return (
            <rect
              key={`building-${b.id}`}
              data-testid={`building-${b.id}`}
              data-building-type={b.type}
              x={cx - size / 2}
              y={cy - size / 2}
              width={size}
              height={size}
              fill="none"
              stroke={color}
              strokeWidth={3}
              rx={4}
            />
          );
        })}

        {/* Unit markers — circle with the seat colour. */}
        {state.units.map((u) => {
          const cx = px(u.square.x) + CELL / 2;
          const cy = px(u.square.y) + CELL / 2;
          return (
            <circle
              key={`unit-${u.id}`}
              data-testid={`unit-${u.id}`}
              data-owner={u.owner}
              data-exhausted={u.exhausted ? 'true' : 'false'}
              cx={cx}
              cy={cy}
              r={CELL * 0.28}
              fill={SEAT_COLOR[u.owner]}
              stroke="#0b0b0b"
              strokeWidth={2}
              opacity={u.exhausted ? 0.55 : 1}
            />
          );
        })}
      </svg>
    </section>
  );
};
