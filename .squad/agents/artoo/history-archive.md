# Artoo — History Archive

Older entries archived from `history.md` by Scribe to keep the active file under 15KB.

---

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

### 2026-05-20: Issue #3 — Card kinds discriminated union
- Files: `packages/schema/src/civ.ts` (leaf), `packages/schema/src/cards.ts` (the union), 60 tests.
- **Decision: `effect` and `trigger` are `z.unknown()` for MVP-1.** See merged decision.
- **Reaction is a schema-only stub** for MVP-1. Rules engine does NOT resolve reactions yet.
- **New pattern: leaf-file for circular-import breaking** — when a barrel re-exports a submodule that needs an enum declared in the barrel, extract enum to leaf file (no internal imports).
- **Technology subtypes A|B|C|D** flagged `@needs-confirmation`.

### 2026-05-20: Issue #4 — GameState / Player / UnitInstance / BuildingInstance
- Files: `packages/schema/src/state.ts`, 50 tests, fixture in worker.
- **Decisions (merged):** `BuildingInstance` is `.strict()` discriminated union; `PlayersBySeat` is explicit object with optional seats (NOT `z.record`); `GameId` unbranded; `ActionLogEntry.payload: z.unknown()` `@needs-confirmation`.
- **`.strict()` lesson:** When a discriminated-union variant must FORBID a field another variant has, you MUST `.strict()` the variants. Default `.strip()` silently removes the field and parse succeeds.
- **Cycle avoidance:** locally re-declared map schemas in `state.ts` (header comment marks structural-twin status). Cleaner long-term: extract `map.ts` leaf.
- **Capital HP:** rulebook 10 (base) / 20 (long). Schema accepts any `int >= 0`; fixture uses 10. Production init eventually moved to 20 (see #57 below).
- **Hand cap 7 / Active events cap 3** enforced at schema level.
- **Vitest auto-discovers tests** regardless of tsconfig `include` — still update `include` to keep typecheck honest.

### 2025-11-21: Issue #6 — Rules engine phase machine + legal-action gating
- Files: `packages/rules/src/{result.ts, phases.ts, applyAction.ts}`, 81 gating tests + 11 behavior tests.
- **Decisions merged:** `Result`/`RuleError` live in `@eoe/rules` not `@eoe/schema`; `RuleErrorCode` closed union; `ACTION_PHASE_LEGALITY` static table; `actorId: Seat` not `PlayerId`.
- **Reactions** are phase-agnostic — gate on `actorId !== state.activePlayer`, mapped to synthetic `'opponent-turn'` legality marker.
- **`rotateSeat(state)` returns `{ next, wrapped }`** — `wrapped` signals turn increment. Skips empty seats. Works for 2/3/4-player without branching.
- **`drawAndDiscardCleanup(state)` is the EndTurn extension point** — no-op today, lifts as #7/#8 land.
- **Purity invariants:** no `fs/path/fetch/crypto/Math.random/Date.now`, no input mutation. Hand-verified.
- **Test pattern: table-driven over `ACTION_TYPES × ALL_PHASES`** — adding a new action automatically gets phase coverage.
- **Immutability check via `structuredClone`** + `toEqual(deepCloneBefore)`.
- **`create_file` cannot overwrite** — use `replace_string_in_file` or write `.new` + `mv -f` for full-file replacement.

### 2026-05-21: Issue #12 — Worker POST /games + /join (KV-backed game creation)
- Files: `apps/worker/src/{http.ts, random.ts, game-init.ts, kv-store.ts, request-schema.ts, routes/create-game.ts, routes/join-game.ts, index.ts}`, 19 new tests.
- **KV schema:** `StoredGame = { state: GameState; tokenHashes: {1?,2?,3?,4?: string} }`. Key `game:<code>`. Version lives ONLY on `state.version`.
- **gameCode:** 6 chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no I/O/L/0/1). 5 collision retries → 503 `code_collision`.
- **Token-hash flow:** plaintext base64url returned once; only `sha256Hex` persisted. Tests assert plaintext absent from KV blob.
- **Error response shape:** `{code, error, details?}`. Codes: `invalid_json`, `invalid_body`, `not_found`, `game_full`, `code_collision`, `not_implemented`.
- **Deck shuffled deterministically** via `mulberry32(seedFor({seed, turn:1, activePlayer:1}, 'shuffle:deck:<seat>'))`.
- **Deck padding `@needs-confirmation`:** Pad civ decks to `MIN_DECK_AFTER_DRAW + STARTING_HAND_SIZE = 12` with `<civ>-placeholder-<i>` ids when source data is thin. Revisited when card catalogs ship.
- **`exactOptionalPropertyTypes` gotcha:** `firstPlayerSecondPlayerWild` must be conditionally-spread (`{...player, firstPlayerSecondPlayerWild: true}`) not always-assigned, so seat 1 gets the correct absent-key shape.
- **Workspace dep gotcha:** Worktree `pnpm install` wants to rebuild `node_modules` and breaks junctions. Workaround: manually symlink `apps/worker/node_modules/@eoe/<pkg>` in the main checkout; worktree picks it up.
- Decision: `.squad/decisions/inbox/artoo-worker-kv-contract.md` (merged).

### 2026-05-22: Issue #39 — CI e2e workflow (PR #47)
- `.github/workflows/e2e.yml` runs Playwright on PRs and pushes to main touching apps/web, apps/worker, apps/e2e, packages/, lockfiles.
- pnpm/action-setup@v4 (no version pin — uses packageManager from root package.json), actions/setup-node@v4 with node 20 + pnpm cache.
- Playwright browser cache keyed on pnpm-lock.yaml + apps/e2e/package.json hash.
- 15-min timeout. Concurrency cancels in-progress runs on same ref. Artifacts (playwright-report/, test-results/) uploaded only on failure, 7-day retention.

---

For active history, see `history.md` in this directory.

## Archived 2026-05-28 by Scribe (history.md ≥ 15KB) — MVP-3 + MVP-4 detail blocks

### 2026-05-22: Issue #57 — Capital placement + board init extracted to @eoe/rules (PR #61)

- **Moved from worker → `packages/rules/`:** `constants.ts` (`CAPITAL_DEFAULT_HP = 20`, `STARTING_HAND_SIZE = 5`, `MIN_DECK_AFTER_DRAW = 7`), `shuffle.ts` (`shuffleWith<T>`), `initialState.ts` (`buildCreatorState`, `addJoiner`). Worker's `game-init.ts` is now a 14-line re-export shim — call sites unchanged.
- **Capital ids:** `bld-cap-p1` / `bld-cap-p2` (issue spec). HP = 20 (long-game default per rulebook §324). Anchor squares (0,0) and (5,5); MVP-4 will randomize.
- **Production HP changed 10 → 20.** Test fixtures kept at 10 — they're round-trip sample data, not init-output assertions. Touching them is cosmetic.
- **Issue-vs-schema reconciliation:** Issue text mentioned `tileId`/`siegeState` on `BuildingInstance` and per-player `units[]`. None exist in current schema. Did NOT add them. Decision filed at `.squad/decisions/inbox/artoo-capital-init.md` (merged) noting schema RFC needed before siege card effects.
- **Worktree gotcha:** pnpm-installed `apps/worker/node_modules/@eoe/<pkg>` were REAL directory copies (not symlinks) in worktrees. New files invisible to the worker until `rmdir /S /Q` + re-`mklink /J` with **absolute paths** (relative paths resolve against cmd CWD, not link location).
- Tests: rules 121 → 136 (+15), worker 43 → 44 (+1).

### 2026-05-22: Issue #56 — Scout action handler (PR #62, silent-success)

- **Files:** `scout.ts`, +2 error codes (`tile_not_found`, `tile_already_revealed`), wired into `applyAction`, 11 tests.
- **Shape lesson:** Spawn prompt guessed `tileId: TileId` but `ScoutAction` is `{ type, unitId, target: Coord }`. Resolved containing tile by walking `state.map.tiles[*].squares[*].coord` — matches the rest of the engine (everything speaks Coords).
- **Decision pinned (overrode prompt):** Rules engine does NOT bump `state.version` — Worker owns version. Declined the prompt's "Return Ok with bumped version" instruction.
- **MVP-3 simplifications:** no adjacency rule, no card cost, no per-turn cap, `unitId` not validated (`@needs-confirmation`), no re-orientation step.
- **Defensive target check:** existing `phases.test.ts` table-driven test stubs Scout as `{ type: 'Scout' }` with no `target`. Added guard at the top returning `tile_not_found` if `target` missing/malformed.
- **Silent-success:** finished file writes but spawn returned empty. Coordinator filesystem-checked + ran tests + opened PR.
- **Cross-worktree terminal noise:** Multiple concurrent worktrees in the same shell can cross-contaminate output. Pipe vitest to `/tmp/<task>-test.log` via `nohup ... &` and tail the file for clean reads.

### 2026-05-22: Issues #53/#54/#55 + hotfix #63 + CI #64

- **#53 DeployUnit (PR #59):** Mobilization-phase gated, pays cost via catalog lookup, places on `state.units` with `owner: Seat`, `exhausted: false`. 14 tests.
- **#63 Hotfix:** deployUnit tests migrated from removed `byz-unit-placeholder` to real `eng-watchman`. Reinforces `artoo-test-fixtures-use-real-catalog.md` decision.
- **#64 CI gap:** Added `.github/workflows/unit-tests.yml` running `pnpm -r test` on every PR.
- **#54 Attack (PR #65):** target square → damage → kill / capital damage / siege flag. **Reuses `UnitInstance.exhausted`** for "already acted" gating; no `actedThisTurn` schema mutation. Decision: `.squad/decisions/inbox/artoo-attack-acted-tracking.md`.
- **#55 Win condition (PR #66, silent-success):** `applyAction` post-mutation hook checks capital HP ≤ 0 OR no opponent units → sets `state.winner: Seat | null`.

### 2025-05-23 — Issue #68: Capital-HP win condition

- **Schema reality:** Issue text said `BuildingInstance.health <= 0` but HP lives on `Player.capitalHp`. `BuildingInstance` only carries `damage`. Implemented win check against `Player.capitalHp <= 0`.
- **Attack still did NOT damage capitals at that point** — `attack.ts:86` returned `not_implemented` for building targets. Win condition testable only via synthetic state until #79.
- **Win precedence via code ordering.** Units-eliminated check runs first and `return`s if it fires; capital-HP check unreachable on that turn. No flag, no extra branching.
- **4-player corner rule.** Game ends ONLY when EXACTLY ONE occupied seat has `capitalHp > 0`. Single dead capital in 4-player game ≠ game end.

### 2026-05-23 — Issue #78: Attack against Capital damages capitalHp (PR #79)

- **Lifted the MVP-4 stub.** Branched off `attackBuilding()` helper mirroring unit-target validation but writing to `Player.capitalHp`.
- **HP lives on `Player.capitalHp`, not on the building** — consistent with #68. `BuildingInstance.damage` deliberately not updated to keep the source of truth single.
- **No clamp at 0.** `capitalHp` allowed to go negative; #68's `<= 0` check still registers as dead.
- **Capital never removed from `state.buildings`.** Persists at any HP; win declaration via `Player.capitalHp` on EndTurn.
- **Non-capital buildings stayed `not_implemented`** at the time. Camp/Barracks target rejection pinned with a test.
- **Cassian's playable-arc Arc 2 unskipped.** Full action-driven capital-zero arc chains through `applyAction` with no shortcuts.
- **Tests:** attack.test.ts 25 → 39 (+11 capital-target). playable-arc.test.ts 4 → 5 passing. Rules suite 251 → 262 passing, 21 skipped.
- **No new error codes.** Reused existing taxonomy; `RuleErrorCode` stable.
