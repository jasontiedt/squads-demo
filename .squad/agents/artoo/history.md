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

### 2025-11-21: Issue #2 — ResourceToken & TemporaryResource schemas
- **Files:** `packages/schema/src/resources.ts` (new), `packages/schema/src/index.ts` (added re-export), `packages/schema/src/__tests__/resources.test.ts` (new, 20 tests).
- **Schemas:** `ResourceTokenId` (branded), `TemporaryResourceId` (branded — added beyond AC for symmetry), `ResourceKind` enum, `ResourceToken`, `TemporaryResource` with `.refine()` enforcing `current ≤ max`.
- **Branded-id pattern:** First branded ID in the schema package — `z.string().min(1).brand<'X'>()`. Issue #1's `Tile.id` was unbranded `z.string().min(1)`. Future entity IDs (CardId, CampId, PlayerId-token) should follow the branded pattern.
- **`@needs-confirmation` flag:** Included `'stone'` in `ResourceKind` per issue #2 AC, but rulebook synthesis only enumerated `{food, wood, gold, wild}`. Inline comment + PR note flagged. Resolution depends on whether `mine` terrain produces stone tokens or feeds gold.
- **Optional-field pattern:** Under `exactOptionalPropertyTypes`, `sourceCampId?: z.string().min(1).optional()` enforces "absent OR non-empty" — a test pins this (`sourceCampId: ''` rejected).
- **Refine error messages** are reachable on `safeParse().error.issues[0].message` — used to assert the overflow message specifically.

### 2026-05-20: Issue #3 � Card kinds discriminated union

- **Files created:** packages/schema/src/civ.ts (leaf), packages/schema/src/cards.ts (the union), packages/schema/src/__tests__/cards.test.ts (60 tests).
- **Files modified:** packages/schema/src/index.ts (re-exports civ.ts + cards.ts; removed local Civ enum and bare CardId = z.string(); Deck/GameState/PlayCardAction now use the branded CardId imported from cards.ts), packages/schema/src/resources.ts (strengthened stone @needs-confirmation comment with rulebook line 47 citation, mine?gold correction, OUT OF SCOPE note).
- **Schemas:** CardId (branded), CardCost (record over ResourceKind, nonnegative ints), 8 per-kind objects (Unit/Technology/Tactic/Upgrade/Action/Reaction/Event/Civilization), Card discriminated union on kind, CARD_KINDS const tuple + CardKind type.
- **Decision pinned (separate doc): effect and trigger are z.unknown() for MVP-1.** See .squad/decisions/inbox/artoo-card-effect-typing.md. Trade-off: z.unknown() accepts undefined, so missing trigger is not rejected � flagged with a comment in the schema and covered by a positive accepts arbitrary trigger test instead of a rejection test.
- **Reaction is a schema-only stub** for MVP-1 � header comment makes that explicit. Rules engine does NOT resolve reactions yet.
- **Stone status (still flagged):** Confirmed with rulebook line 47 (5 Food, 5 Wood, 5 Gold, 3 Wild) that stone is NOT in the rulebook. Per user direction, kept stone in ResourceKind for issue #3 (out of scope to remove) but strengthened the comment so future readers know not to add code paths that depend on it. Mine terrain produces gold, not stone (rulebook page 4 diagram).
- **Technology subtypes** A|B|C|D per issue spec � rulebook line 279 says There are 4 different technology types but doesn't name them. @needs-confirmation comment flags this for replacement once a civ booklet enumerates them.
- **New pattern: leaf-file for circular-import breaking.** cards.ts originally imported Civ from ./index.js, but index.ts re-exports ./cards.js. ESM cycle would TDZ Civ because z.optional() evaluates eagerly at module load. Fix: extract Civ to leaf civ.ts with no internal imports; both index.ts and cards.ts import from it. Use this pattern any time a barrel re-exports a submodule that needs an enum declared in the barrel.
- **Test count:** 60 in cards.test.ts (CardId 3, CardCost 5, per-kind ~3-4 each � 8, common-fields parametrized � 8 � 3, union/exhaustiveness 4). Total schema package: 98 passing.
- Branch: copilot/3-schema-card-kinds. PR body must include Closes #3 plus stone-status section + Technology-subtypes @needs-confirmation flag.

### 2026-05-20: Issue #4 — GameState, Player, UnitInstance, BuildingInstance

- **Files added:** `packages/schema/src/state.ts` (the model), `packages/schema/src/__tests__/state.test.ts` (50 tests), `apps/worker/test/fixtures/initial-state.ts` (English-vs-Byzantines fixture), `apps/worker/test/initial-state.test.ts` (3 tests parsing the fixture).
- **Files modified:** `packages/schema/src/index.ts` rewritten — removed obsolete old `Player`/`GameState`/`Deck`/`GamePhase`/old `TurnPhase` (draw/main/combat/end). Kept `GameId`/`PlayerId`/`PlayerToken`/`Seat`/Map types and the placeholder `Action` union (rules tests + worker stub still depend on these — full action union lands in #5). Added `export *` of `./state.js`. Also added `apps/worker/tsconfig.json` `include: ["src/**/*", "test/**/*"]` so the fixture+test typecheck under strict.
- **Decisions pinned (separate doc):** see `.squad/decisions/inbox/artoo-gamestate-shape.md`.
  - **BuildingInstance is a Zod discriminated union by `type`** with three variants (Camp/Barracks/Capital), each `.strict()`. Rationale: discriminator gives type narrowing at consumption sites AND `.strict()` makes "terrain only on Camp" a structural rule — a Barracks shape with `terrain: 'plain'` is rejected at parse time, not silently stripped. Alternative (single object + `.refine`) was rejected because it loses narrowing and produces worse error messages.
  - **`PlayersBySeat` is `z.object({1: Player.optional(), 2: Player.optional(), 3: Player.optional(), 4: Player.optional()})`, NOT `z.record(Seat, Player)`.** JSON object keys are always strings; `Seat = z.union([z.literal(1)..z.literal(4)])` rejects string keys with `invalid_literal` errors. Explicit object with optional fields is the strict-mode correct shape.
  - **`GameId` kept unbranded** (`z.string().min(4).max(16)`). The worker stub passes raw `'STUB01'`; branding would force a cast at every API boundary for no real safety win at this stage. Revisit if/when worker generates ids itself.
  - **`ActionLogEntry.kind: z.string().min(1)` and `payload: z.unknown()`** — minimal stub flagged `@needs-confirmation`. Tightens to a discriminated union after #5 ships the full Action schema.
- **Cycle avoidance:** `state.ts` needs `Seat`/`Coord`/`TerrainType`/`Square`/`TileKind`/`TileOrientation`/`Tile` but `index.ts` already re-exports `./state.js`. Importing from `./index.js` would TDZ those schemas (Zod evaluates eagerly at module load, same hazard as the cards.ts/civ.ts split). Fix: locally re-declared the seven schemas inside `state.ts` with a header comment noting they are structurally identical to the index.ts exports and MUST stay in sync — production code should import from the barrel, only `state.ts` itself uses the local copies. Cleaner long-term fix is to extract a `map.ts` leaf, but that's a refactor for a separate issue.
- **`PlayersBySeat` first attempt:** `z.record(Seat, Player)` — failed two tests (`accepts a state with all 4 seats populated`, etc.) with `code: invalid_literal, expected: 1, received: '1'`. Confirmed Zod validates record keys against the schema as-given; numeric-literal unions don't match string keys. Fix described above.
- **`.strict()` on building variants:** Initial implementation used plain `z.object`; tests `rejects Barracks with terrain` and `rejects Capital with terrain` failed because Zod default mode is `.strip()` — unknown keys are silently removed, parse succeeds. Solution: every building variant is `z.object({...}).strict()`. Pattern worth remembering: **when a discriminated-union variant is supposed to forbid a field that another variant has, you MUST `.strict()` the variants. The discriminator alone doesn't enforce field-set boundaries; only `.strict()` does.**
- **Capital HP source:** Rulebook setup (line 77) sets capital to 10 HP base game; long game (line 324) is 20 HP. Schema accepts any `int >= 0`, fixture uses 10. Comment in `Player.capitalHp` references both lines.
- **Hand cap:** Rulebook §6.3 says "your hand can never have more than 7 cards" — enforced at schema level via `z.array(CardId).max(7)` on `Player.hand`. Drawing past 7 is a rules-engine concern (#5), not a schema concern; the schema rejects already-overfull states.
- **Active events cap:** `Player.activeEvents.max(3)` — same rulebook line, "no more than three Event cards in play at once for any one player" (line ~187).
- **Tests passing:** 148/148 in `@eoe/schema`, 4/4 in `@eoe/worker` (including 3 fixture parses), 1/1 in `@eoe/rules`, 7/7 in `@eoe/assets-meta`. All five `tsc --noEmit` typechecks clean.
- **Workspace gotcha (re-confirmed):** Vitest auto-discovers `**/*.test.ts` regardless of tsconfig `include`. The fixture test in `apps/worker/test/` runs fine even without tsconfig changes — but typecheck would skip it. Always update `include` when you add test directories outside `src/`.
- Branch: `copilot/4-schema-gamestate`. PR body includes `Closes #4`, the four pinned decisions, the `@needs-confirmation` on `ActionLogEntry`, and the cycle-avoidance comment about local re-declarations being a temporary structure that #5+ may refactor into a `map.ts` leaf module.
