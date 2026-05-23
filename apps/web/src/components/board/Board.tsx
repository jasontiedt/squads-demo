// ─────────────────────────── Board view ─────────────────────────────
//
// Issue #70 (MVP-4) — INTERACTIVE board. The original render-only
// renderer from #35 stays intact: if no interaction props are passed,
// the board renders exactly as before. Click/right-click/keyboard
// handlers and the legal-target overlay are opt-in via props.
//
// Selection lives in the parent (Lobby) — Board.tsx receives:
//   - `selectedUnitId`        which unit (if any) is currently selected
//   - `legalTargets`          set of coord-keys ('x,y') that should
//                             show as legal pickable squares
//   - `legalTargetUnitIds`    set of unit ids that should highlight as
//                             enemy attack targets
//   - `legalTargetBuildingIds` set of building ids that should
//                             highlight as attack targets
//   - `onUnitClick`           friendly/enemy unit clicked
//   - `onSquareClick`         a square (cell) was clicked — used for
//                             Move/Scout/Deploy
//   - `onBuildingClick`       building marker clicked (for capital attacks)
//   - `onClearSelection`      right-click / Escape — Lobby resets
//
// The Worker re-validates EVERY action; this layer's only job is to
// keep the picker focused so the user isn't drowning in red toasts.
//
// Why we keep the legacy `data-testid="region-{x}-{y}"` markers AND add
// the spec-required `cell-{x}-{y}` markers: existing tests assert on
// the region testid (#35), and the spec for #70 + the upcoming #72
// E2E suite wants the more obvious `cell-{x}-{y}`. Both live on the
// same square — region- on the outer group, cell- on the click rect.

import { type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { PublicGameState } from '../../api/client.js';
import type {
  BuildingInstance,
  Coord,
  Seat,
  TerrainType,
  UnitInstance,
} from '@eoe/schema';

// ─────────────────────────── Layout constants ───────────────────────

const BOARD_SIZE = 6;
const CELL = 64;
const PAD = 8;
const TILE_SIZE = 2;
const SVG_DIM = BOARD_SIZE * CELL + PAD * 2;

// ─────────────────────────── Terrain palette ────────────────────────

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

const EMPTY_FILL = '#1c1c1c';
const SELECTED_STROKE = '#f3d144';
const LEGAL_OVERLAY = 'rgba(108, 207, 255, 0.30)';
const LEGAL_STROKE = '#6cf';
const ATTACK_OVERLAY = 'rgba(217, 79, 79, 0.45)';
const ATTACK_STROKE = '#ff7a7a';

const SEAT_COLOR: Record<Seat, string> = {
  1: '#d94f4f',
  2: '#4f9ed9',
  3: '#d9b94f',
  4: '#a44fd9',
};

// ─────────────────────────── Helpers ────────────────────────────────

const coordKey = (c: Coord): string => `${c.x},${c.y}`;
const px = (n: number): number => PAD + n * CELL;

function indexSquares(
  state: PublicGameState,
): ReadonlyMap<string, TerrainType> {
  const out = new Map<string, TerrainType>();
  for (const tile of state.map.tiles) {
    if (tile.faceDown) continue;
    for (const sq of tile.squares) out.set(coordKey(sq.coord), sq.terrain);
  }
  return out;
}

function indexFaceDownSquares(
  state: PublicGameState,
): ReadonlySet<string> {
  const out = new Set<string>();
  for (const tile of state.map.tiles) {
    if (!tile.faceDown) continue;
    for (const sq of tile.squares) out.add(coordKey(sq.coord));
  }
  return out;
}

// ─────────────────────────── Component ──────────────────────────────

export interface BoardProps {
  state: PublicGameState;

  /** Currently selected unit (if any) — drawn with a yellow outline. */
  selectedUnitId?: string | undefined;
  /** Square coord-keys ('x,y') that should highlight as legal pickable. */
  legalTargets?: ReadonlySet<string> | undefined;
  /** Unit ids that should highlight as attack targets (red overlay). */
  legalTargetUnitIds?: ReadonlySet<string> | undefined;
  /** Building ids that should highlight as attack targets (red overlay). */
  legalTargetBuildingIds?: ReadonlySet<string> | undefined;

  /** Click on any square. `coord` is grid-local. */
  onSquareClick?: ((coord: Coord) => void) | undefined;
  /** Click on a unit marker (friendly OR enemy). */
  onUnitClick?: ((unit: UnitInstance) => void) | undefined;
  /** Click on a building marker (used for capital attacks). */
  onBuildingClick?: ((building: BuildingInstance) => void) | undefined;
  /** Right-click or Escape on the board — parent resets selection. */
  onClearSelection?: (() => void) | undefined;
}

export const Board = ({
  state,
  selectedUnitId,
  legalTargets,
  legalTargetUnitIds,
  legalTargetBuildingIds,
  onSquareClick,
  onUnitClick,
  onBuildingClick,
  onClearSelection,
}: BoardProps): JSX.Element => {
  const terrainBySquare = indexSquares(state);
  const faceDownSquares = indexFaceDownSquares(state);
  const interactive =
    onSquareClick !== undefined ||
    onUnitClick !== undefined ||
    onBuildingClick !== undefined;

  // Stable 6×6 cell list. All 36 cells always render; missing terrain
  // gets the empty fill. Keeps React keys stable across polls.
  const cells: {
    x: number;
    y: number;
    terrain: TerrainType | null;
    faceDown: boolean;
  }[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const key = `${x},${y}`;
      const terrain = terrainBySquare.get(key) ?? null;
      cells.push({ x, y, terrain, faceDown: faceDownSquares.has(key) });
    }
  }

  /** Right-click on the SVG clears selection. */
  const handleContextMenu = (e: ReactMouseEvent<SVGElement>): void => {
    if (onClearSelection === undefined) return;
    e.preventDefault();
    onClearSelection();
  };

  /** Esc key on the focused board clears selection. */
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    if (e.key === 'Escape' && onClearSelection !== undefined) {
      onClearSelection();
    }
  };

  return (
    <section
      className={`board${interactive ? ' board-interactive' : ''}`}
      aria-label="Game board"
      data-testid="board"
      data-board-size={BOARD_SIZE}
      tabIndex={interactive ? 0 : -1}
      onKeyDown={interactive ? handleKeyDown : undefined}
    >
      <svg
        viewBox={`0 0 ${SVG_DIM} ${SVG_DIM}`}
        width="100%"
        role="img"
        aria-label={`${BOARD_SIZE} by ${BOARD_SIZE} square game board`}
        className="board-svg"
        onContextMenu={handleContextMenu}
      >
        {/* Cells */}
        {cells.map(({ x, y, terrain, faceDown }) => {
          const fill = terrain === null ? EMPTY_FILL : TERRAIN_FILL[terrain];
          const key = `${x},${y}`;
          const isLegal = legalTargets?.has(key) ?? false;
          const label =
            terrain === null
              ? `Square ${x},${y}: unrevealed`
              : `Square ${x},${y}: ${TERRAIN_LABEL[terrain]}`;
          const clickable = onSquareClick !== undefined;
          return (
            <g
              key={`cell-g-${x}-${y}`}
              data-testid={`region-${x}-${y}`}
              data-terrain={terrain ?? 'unrevealed'}
              data-face-down={faceDown ? 'true' : 'false'}
            >
              <title>{label}</title>
              <rect
                data-testid={`cell-${x}-${y}`}
                data-target-legal={isLegal ? 'true' : 'false'}
                x={px(x)}
                y={px(y)}
                width={CELL}
                height={CELL}
                fill={fill}
                stroke="#0b0b0b"
                strokeWidth={1}
                style={clickable ? { cursor: 'pointer' } : undefined}
                onClick={
                  clickable
                    ? () => onSquareClick({ x, y })
                    : undefined
                }
              />
              {isLegal && (
                <rect
                  data-testid={`target-legal-${x}-${y}`}
                  className="target-legal"
                  x={px(x) + 2}
                  y={px(y) + 2}
                  width={CELL - 4}
                  height={CELL - 4}
                  fill={LEGAL_OVERLAY}
                  stroke={LEGAL_STROKE}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}

        {/* Tile borders. */}
        {Array.from({ length: BOARD_SIZE / TILE_SIZE + 1 }, (_, i) => {
          const pos = px(i * TILE_SIZE);
          return (
            <g key={`tilegrid-${i}`} className="board-tile-grid" pointerEvents="none">
              <line x1={pos} y1={PAD} x2={pos} y2={SVG_DIM - PAD} stroke="#0b0b0b" strokeWidth={2.5} />
              <line x1={PAD} y1={pos} x2={SVG_DIM - PAD} y2={pos} stroke="#0b0b0b" strokeWidth={2.5} />
            </g>
          );
        })}

        {/* Building markers — drawn before units so a stacked unit visually wins. */}
        {state.buildings.map((b) => {
          const cx = px(b.square.x) + CELL / 2;
          const cy = px(b.square.y) + CELL / 2;
          const color = SEAT_COLOR[b.owner];
          const size = b.type === 'capital' ? CELL * 0.45 : CELL * 0.3;
          const isLegalTarget = legalTargetBuildingIds?.has(b.id) ?? false;
          const clickable = onBuildingClick !== undefined;
          return (
            <rect
              key={`building-${b.id}`}
              data-testid={`building-${b.id}`}
              data-building-type={b.type}
              data-target-legal={isLegalTarget ? 'true' : 'false'}
              x={cx - size / 2}
              y={cy - size / 2}
              width={size}
              height={size}
              fill={isLegalTarget ? ATTACK_OVERLAY : 'none'}
              stroke={isLegalTarget ? ATTACK_STROKE : color}
              strokeWidth={3}
              rx={4}
              style={clickable ? { cursor: 'pointer' } : undefined}
              onClick={
                clickable
                  ? (e) => {
                      e.stopPropagation();
                      onBuildingClick(b);
                    }
                  : undefined
              }
            />
          );
        })}

        {/* Unit markers. */}
        {state.units.map((u) => {
          const cx = px(u.square.x) + CELL / 2;
          const cy = px(u.square.y) + CELL / 2;
          const isSelected = selectedUnitId === u.id;
          const isAttackTarget = legalTargetUnitIds?.has(u.id) ?? false;
          const clickable = onUnitClick !== undefined;
          return (
            <g
              key={`unit-${u.id}`}
              data-testid={`unit-${u.id}`}
              data-owner={u.owner}
              data-exhausted={u.exhausted ? 'true' : 'false'}
              data-selected={isSelected ? 'true' : 'false'}
              data-target-legal={isAttackTarget ? 'true' : 'false'}
            >
              {isAttackTarget && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={CELL * 0.36}
                  fill={ATTACK_OVERLAY}
                  stroke={ATTACK_STROKE}
                  strokeWidth={3}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={CELL * 0.28}
                fill={SEAT_COLOR[u.owner]}
                stroke={isSelected ? SELECTED_STROKE : '#0b0b0b'}
                strokeWidth={isSelected ? 4 : 2}
                opacity={u.exhausted ? 0.55 : 1}
                style={clickable ? { cursor: 'pointer' } : undefined}
                onClick={
                  clickable
                    ? (e) => {
                        e.stopPropagation();
                        onUnitClick(u);
                      }
                    : undefined
                }
              />
            </g>
          );
        })}
      </svg>
    </section>
  );
};
