# Project Context

- **Owner:** Jason T
- **Project:** squads-demo — virtual boardgame on GitHub Pages, turn-based multiplayer, image-rich (maps/units/cards), rules driven by text docs
- **Stack:** TBD — game state shape and persistence layer pending architecture decisions
- **Created:** 2026-05-20

## Learnings

<!-- Append new learnings below. -->

### 2026-05-20: Issue #1 — Map schemas (Coord, Tile, Square, Terrain)

- Added Zod schemas to `packages/schema/src/index.ts` under a "Map" section between TurnPhase and Players: `Coord`, `TerrainType`, `Square`, `TileKind`, `TileOrientation`, `Tile`. Types inferred via `z.infer` — never duplicated.
- **Decisions pinned in code (matching Wedge's rulebook synthesis):**
  - `Coord`: `x`/`y` integers in `[0, 5]` (6×6 base map = 3×3 tiles × 2×2 squares).
  - `TerrainType` enum: `plain | mountain | water | river | village | farmland | forest | mine | gold-double` (9 values from rulebook).
  - `Square` uses field name `coord` (verbatim per Issue #1 spec), not `position`.
  - `TileOrientation`: `z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])` — strict literal degrees, rejects 45/360 and string `'90'`.
  - `Tile.squares` enforced to `.length(4)` (2×2 grid).
  - `TileKind`: `starting | highland | constantinople`.
- Tests in `packages/schema/src/__tests__/map.test.ts` — 18 tests, round-trip + invalid-input coverage per type. Vitest, ESM `.js` import suffix.
- Tile *data population* (the actual starting tile catalog from `documentation/StartingTiles.txt`) is out of scope for #1 — separate issue.
- **Workspace gotcha:** `pnpm` is not on PATH on this Windows box. Use `npx -y -p pnpm@9 pnpm ...`. After fresh clone you must `npx -y -p pnpm@9 pnpm install` once before `tsc` is available at `node_modules/.bin/`.
- **Repo dirty-state gotcha:** main has unrelated uncommitted files (.github/prompts, wedge history, untracked docs/scripts). NEVER `git add .` on this repo — stage exact paths only.
- Branch: `copilot/1-schema-coord-tile-square-terrain`. PR body must include `Closes #1`.
